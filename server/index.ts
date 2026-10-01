/**
 * ee.io quote & routing server.
 *
 * Why a server at all, for a non-custodial app? Three reasons:
 *  1. Aggregator API keys (0x, 1inch) must not ship in a browser bundle.
 *  2. CORS — several aggregator APIs do not allow direct browser calls.
 *  3. Rate limits are per-IP; THORChain's /quote is 1 req/s.
 *
 * What the server deliberately does NOT do: hold keys that can move user
 * funds, or sit between the user and the chain. It returns transaction
 * payloads; the user's own wallet signs and broadcasts them.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { ASSETS } from '../shared/assets.js';
import { CHAINS } from '../shared/chains.js';
import {
  adapterCatalogue,
  buildQuote,
  chainCatalogue,
  defaultSlippageBps,
  feeBpsFor,
} from './quoteEngine.js';
import { buildExecutionPlan } from './executionPlanner.js';
import { createOrder, getOrder, listOrders, markDeposited } from './orders.js';
import { createDeposit, getDeposit, listDeposits, markDepositFunded } from './depositProxy.js';
import { credentialStatus, isPlaceholderRecipient, loadFeePolicy } from './config.js';
import { getPrices, priceLookup } from './prices.js';
import { requireAsset } from '../shared/assets.js';
import { ADAPTERS } from './quoteEngine.js';
import { scanNow, startNotifyWatcher, subscribeSse, validateWebhookUrl } from './notify.js';
import { partnerRouter } from './partnerRoutes.js';
import { venueCatalogue } from './venueHealth.js';
import { depositReceipt, orderReceipt } from './receipt.js';

const app = express();
const PORT = Number(process.env.API_PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// A malformed JSON body otherwise surfaces Express's default HTML stack page —
// the API contract is JSON, so every caller (and the ui) cleanly sees an error.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (
    err instanceof SyntaxError ||
    (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed')
  ) {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  next(err);
});

app.use((req, _res, next) => {
  const started = Date.now();
  _res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`${req.method} ${req.path} → ${_res.statusCode} (${Date.now() - started}ms)`);
    }
  });
  next();
});

/* ------------------------------------------------------------- catalogue */

app.get('/api/health', (_req, res) => {
  const policy = loadFeePolicy();
  res.json({
    ok: true,
    version: '0.2.0',
    providers: credentialStatus(),
    fee: {
      floatBps: policy.floatBps,
      fixedBps: policy.fixedBps,
      chargeOn: policy.chargeOn,
      recipientConfigured: !isPlaceholderRecipient(policy),
      thornameConfigured: Boolean(policy.recipients.thorchain),
      solanaConfigured: Boolean(policy.recipients.solana),
    },
  });
});

app.get('/api/assets', async (_req, res) => {
  const priceEntry = await getPrices();
  const priceOf = priceLookup(priceEntry);

  res.json({
    priceMode: priceEntry.live ? 'live' : 'reference',
    assets: ASSETS.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      chain: asset.chain,
      chainName: CHAINS[asset.chain].name,
      chainKind: CHAINS[asset.chain].kind,
      decimals: asset.decimals,
      address: asset.address,
      color: asset.color,
      colorTo: asset.colorTo,
      usdPrice: priceOf(asset),
      minUsd: asset.minUsd,
      maxUsd: asset.maxUsd,
      addressPlaceholder: asset.addressPlaceholder,
      popular: asset.popular ?? false,
      stable: asset.stable ?? false,
      thorchainAsset: asset.thorchainAsset,
      chainColor: CHAINS[asset.chain].color,
    })),
  });
});

app.get('/api/providers', (_req, res) => {
  res.json({ providers: adapterCatalogue(), chains: chainCatalogue() });
});

/* ----------------------------------------------------------------- quote */

const quoteSchema = z.object({
  fromAssetId: z.string().min(1),
  toAssetId: z.string().min(1),
  amount: z.string().regex(/^\d+$/, 'amount must be an integer string of base units'),
  side: z.enum(['send', 'receive']),
  rateType: z.enum(['float', 'fixed']),
  destinationAddress: z.string().optional(),
  takerAddress: z.string().optional(),
  slippageBps: z.number().int().min(1).max(5000).optional(),
});

app.post('/api/quote', async (req, res) => {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
  }

  try {
    const quote = await buildQuote(parsed.data);
    res.json(quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote failed';
    console.error('[quote]', message);
    res.status(400).json({ error: message });
  }
});

/** Validate a destination address for a given asset — used for live feedback. */
app.get('/api/validate-address', (req, res) => {
  const assetId = String(req.query.assetId ?? '');
  const address = String(req.query.address ?? '');
  try {
    const asset = requireAsset(assetId);
    res.json(asset.validate(address));
  } catch {
    res.status(400).json({ isValid: false, message: 'Unknown asset' });
  }
});

/* ------------------------------------------------------------------ plan */

const planSchema = z.object({
  fromAssetId: z.string(),
  toAssetId: z.string(),
  sendAmount: z.string().regex(/^\d+$/),
  destinationAddress: z.string().min(1),
  takerAddress: z.string().optional(),
  rateType: z.enum(['float', 'fixed']),
  aggregator: z.string(),
  slippageBps: z.number().int().min(1).max(5000).optional(),
  webhookUrl: z.string().optional(),
});

app.post('/api/plan', async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
  }
  const body = parsed.data;

  try {
    const from = requireAsset(body.fromAssetId);
    const to = requireAsset(body.toAssetId);
    const slippageBps = body.slippageBps ?? defaultSlippageBps(body.rateType, from, to);

    // Re-quote so the plan is built from fresh pricing, never a stale client
    // value. This is also where a fixed-rate window would be re-checked.
    const quoteResponse = await buildQuote({
      fromAssetId: body.fromAssetId,
      toAssetId: body.toAssetId,
      amount: body.sendAmount,
      side: 'send',
      rateType: body.rateType,
      destinationAddress: body.destinationAddress,
      takerAddress: body.takerAddress,
      slippageBps,
    });

    const chosen =
      quoteResponse.quotes.find((q) => q.aggregator === body.aggregator && !q.unavailableReason) ??
      quoteResponse.best;

    if (!chosen) {
      return res.status(400).json({ error: 'No executable route for this pair' });
    }

    let webhookUrl: string | undefined;
    if (body.webhookUrl !== undefined) {
      const check = validateWebhookUrl(body.webhookUrl);
      if (!check.ok) {
        return res.status(400).json({ error: `webhookUrl rejected: ${check.reason}` });
      }
      webhookUrl = check.url;
    }

    const plan = await buildExecutionPlan({
      quote: chosen,
      fromAssetId: body.fromAssetId,
      toAssetId: body.toAssetId,
      sendAmount: body.sendAmount,
      destinationAddress: body.destinationAddress,
      takerAddress: body.takerAddress,
      slippageBps,
      expiresAt: quoteResponse.expiresAt,
      rateType: body.rateType,
    });

    const order = createOrder(plan, { webhookUrl });
    res.json({ plan, order, feeBps: feeBpsFor(body.rateType) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Plan failed';
    console.error('[plan]', message);
    res.status(400).json({ error: message });
  }
});

/* ---------------------------------------------------------------- orders */

app.get('/api/orders', (_req, res) => {
  res.json({ orders: listOrders() });
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

app.post('/api/orders/:orderId/simulate-deposit', (req, res) => {
  const order = markDeposited(req.params.orderId, req.body?.txHash);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

/* ------------------------------------------------------ real-time streams */

/**
 * Server-sent events: the browser's EventSource gets every status transition
 * the moment the notify watcher sees it, instead of polling JSON every 2 s.
 * The client still poll-falls-back — SSE is additive, not a hard dependency.
 */
app.get('/api/orders/:orderId/stream', (req, res) => {
  const unsubscribe = subscribeSse(req.params.orderId, res);
  const order = getOrder(req.params.orderId);
  if (order) res.write(`data: ${JSON.stringify(order)}\n\n`);
  req.on('close', unsubscribe);
});

app.get('/api/deposit/:depositId/stream', (req, res) => {
  const unsubscribe = subscribeSse(req.params.depositId, res);
  const deposit = getDeposit(req.params.depositId);
  if (deposit) res.write(`data: ${JSON.stringify(deposit)}\n\n`);
  req.on('close', unsubscribe);
});

/* -------------------------------------------------------- venue health */

app.get('/api/venues', (_req, res) => {
  res.json({ venues: venueCatalogue(ADAPTERS.map((a) => a.id)) });
});

/* ----------------------------------------------------------- partner api */

app.use('/api/partner/v1', partnerRouter());

/* --------------------------------------------------------- deposit proxy (ff.io-style, non-custodial) */

const depositSchema = z.object({
  fromAssetId: z.string().min(1),
  toAssetId: z.string().min(1),
  amount: z.string().regex(/^\d+$/, 'amount must be base-units integer string'),
  destinationAddress: z.string().min(1),
  aggregator: z.string().optional(),
  slippageBps: z.number().int().min(1).max(5000).optional(),
  rateType: z.enum(['float', 'fixed']).optional(),
  // Target lock (v0.4): pin an execution condition above the current floor.
  targetMinReceive: z.string().regex(/^\d+$/, 'targetMinReceive must be base-units integer string').optional(),
  expiresInMinutes: z.number().int().min(15).max(4320).optional(),
  webhookUrl: z.string().optional(),
});

app.post('/api/deposit', async (req, res) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
  let webhookUrl: string | undefined;
  if (parsed.data.webhookUrl !== undefined) {
    const check = validateWebhookUrl(parsed.data.webhookUrl);
    if (!check.ok) return res.status(400).json({ error: `webhookUrl rejected: ${check.reason}` });
    webhookUrl = check.url;
  }
  try {
    const { targetMinReceive, expiresInMinutes, ...rest } = parsed.data;
    const deposit = await createDeposit({ ...rest, targetMinReceive, expiresInMinutes, webhookUrl });
    res.json({ deposit });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Deposit creation failed';
    console.error('[deposit]', msg);
    res.status(400).json({ error: msg });
  }
});

app.get('/api/deposits', (_req, res) => {
  res.json({ deposits: listDeposits() });
});

app.get('/api/deposit/:depositId', (req, res) => {
  const rec = getDeposit(req.params.depositId);
  if (!rec) return res.status(404).json({ error: 'Deposit not found' });
  res.json({ deposit: rec });
});

app.post('/api/deposit/:depositId/funded', async (req, res) => {
  const rec = await markDepositFunded(req.params.depositId, req.body?.txHash);
  if (!rec) return res.status(404).json({ error: 'Deposit not found' });
  res.json({ deposit: rec });
});

/* ----------------------------------------------------------- receipts */

/**
 * Comparison-by-failure-mode needs a machine-readable artifact: the receipt
 * digest over the immutable terms of the trade.
 */
app.get('/api/orders/:orderId/receipt', (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ receipt: orderReceipt(order) });
});

app.get('/api/deposit/:depositId/receipt', (req, res) => {
  const rec = getDeposit(req.params.depositId);
  if (!rec) return res.status(404).json({ error: 'Deposit not found' });
  res.json({ receipt: depositReceipt(rec) });
});

/* ----------------------------------------------------------------- serve */

/**
 * In production the built frontend is served by this same process, so a
 * deployment is a single container with no CORS surface and no separate CDN
 * origin. In development Vite owns :5173 and proxies /api here instead.
 */
const DIST_DIR = path.resolve(process.cwd(), 'dist');
const SERVE_STATIC = existsSync(path.join(DIST_DIR, 'index.html'));

if (SERVE_STATIC) {
  // Hashed asset filenames are immutable; index.html must never be cached or
  // users keep booting an old bundle against a new API.
  app.use(
    '/assets',
    express.static(path.join(DIST_DIR, 'assets'), {
      immutable: true,
      maxAge: '1y',
    }),
  );
  app.use(express.static(DIST_DIR, { index: false }));

  // SPA fallback — anything that is not an API route renders the app shell.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  // Real-time order layer: SSE fan-out + webhook dispatch.
  startNotifyWatcher();
  void scanNow();
  const policy = loadFeePolicy();
  console.log(`\n  ee.io quote server → http://0.0.0.0:${PORT}`);
  console.log(`  fee policy: ${policy.floatBps} bps float / ${policy.fixedBps} bps fixed, charged on ${policy.chargeOn}`);
  console.log(`  fee recipient (EVM): ${policy.recipients.evm}`);
  if (isPlaceholderRecipient(policy)) {
    console.warn('  ⚠  Using the placeholder fee address. Set EE_FEE_RECIPIENT_EVM before taking volume.');
  }
  if (!policy.recipients.thorchain) {
    console.warn('  ⚠  EE_THORNAME is unset — THORChain affiliate fees are disabled.');
  }
  const creds = credentialStatus();
  // `keyless` already includes openocean and jupiter (both serve a public
  // tier), so they must not be appended again or the log double-counts them.
  console.log(`  live providers: ${[creds.zeroEx && '0x', creds.oneInch && '1inch', ...creds.keyless]
    .filter(Boolean)
    .join(', ')}`);
  if (SERVE_STATIC) {
    console.log(`  serving built frontend from ${DIST_DIR}`);
  }
  console.log('');
});
