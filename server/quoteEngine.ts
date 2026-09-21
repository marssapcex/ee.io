/**
 * Quote engine.
 *
 * Fans out to every adapter that can serve the pair, races them under a single
 * deadline, and ranks the results. Any adapter that fails or is missing
 * credentials degrades to a clearly-labelled simulated quote rather than
 * vanishing — the comparison matrix stays complete and honest about provenance.
 */

import { requireAsset, type Asset } from '../shared/assets.js';
import { CHAINS } from '../shared/chains.js';
import { convertByUsd, grossUpBps, toNumber } from '../shared/money.js';
import type {
  AggregatorId,
  AggregatorQuote,
  QuoteRequest,
  QuoteResponse,
  RateType,
} from '../shared/types.js';
import { jupiterAdapter } from './aggregators/jupiter.js';
import { kyberSwapAdapter } from './aggregators/kyberswap.js';
import { oneInchAdapter } from './aggregators/oneinch.js';
import { openOceanAdapter } from './aggregators/openocean.js';
import { paraSwapAdapter } from './aggregators/paraswap.js';
import { thorchainAdapter } from './aggregators/thorchain.js';
import type { Adapter, AdapterContext } from './aggregators/types.js';
import { zeroExAdapter } from './aggregators/zeroex.js';
import {
  FIXED_RATE_WINDOW_SECONDS,
  FLOAT_RATE_WINDOW_SECONDS,
  FORCE_SIMULATION,
  loadFeePolicy,
  QUOTE_DEADLINE_MS,
} from './config.js';
import { getPrices, priceLookup } from './prices.js';
import { simulateQuote } from './simulation.js';

export const ADAPTERS: Adapter[] = [
  zeroExAdapter,
  kyberSwapAdapter,
  oneInchAdapter,
  openOceanAdapter,
  paraSwapAdapter,
  thorchainAdapter,
  jupiterAdapter,
];

const ADAPTER_BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

export function feeBpsFor(rateType: RateType): number {
  const policy = loadFeePolicy();
  return rateType === 'fixed' ? policy.fixedBps : policy.floatBps;
}

/**
 * Default slippage tolerance. Fixed-rate orders quote a firm number, so they
 * need a wider on-chain tolerance to still fill after the deposit window;
 * float orders can stay tight.
 */
export function defaultSlippageBps(rateType: RateType, from: Asset, to: Asset): number {
  const volatile = !from.stable || !to.stable;
  if (rateType === 'fixed') return volatile ? 150 : 50;
  return volatile ? 75 : 20;
}

export async function buildQuote(request: QuoteRequest): Promise<QuoteResponse> {
  const from = requireAsset(request.fromAssetId);
  const to = requireAsset(request.toAssetId);

  if (from.id === to.id) {
    throw new Error('Send and receive assets must differ');
  }

  const priceEntry = await getPrices();
  const priceOf = priceLookup(priceEntry);
  const feePolicy = loadFeePolicy();
  const feeBps = feeBpsFor(request.rateType);
  const slippageBps = request.slippageBps ?? defaultSlippageBps(request.rateType, from, to);

  // Resolve the send amount. A "receive" request is the inverse problem: find
  // the input that produces the requested output. We seed with the fee-grossed
  // price conversion, then refine against the actual routed output — a single
  // price-based estimate would systematically overshoot, because it cannot see
  // slip, gas or the venue spread.
  const requestedAmount = BigInt(request.amount || '0');
  let sendAmount: bigint;

  if (request.side === 'send') {
    sendAmount = requestedAmount;
  } else {
    const grossTarget = grossUpBps(requestedAmount, feeBps);
    sendAmount = convertByUsd(grossTarget, to.decimals, priceOf(to), from.decimals, priceOf(from));
  }

  const warnings: string[] = [];

  if (sendAmount <= 0n) {
    return emptyResponse(request, from, to, warnings, priceEntry.live);
  }

  const checkLimits = (amount: bigint) => {
    const usd = toNumber(amount, from.decimals) * priceOf(from);
    if (usd < from.minUsd) {
      warnings.push(`Below the ${from.symbol} minimum of ~$${from.minUsd}`);
    }
    if (usd > from.maxUsd) {
      warnings.push(`Above the ${from.symbol} maximum of ~$${from.maxUsd.toLocaleString()}`);
    }
    return usd;
  };

  if (request.destinationAddress) {
    const validation = to.validate(request.destinationAddress);
    if (!validation.isValid) {
      warnings.push(`Destination address invalid: ${validation.message}`);
    }
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('deadline')), QUOTE_DEADLINE_MS);

  const ctx: AdapterContext = {
    from,
    to,
    sellAmount: sendAmount,
    feeBps,
    feePolicy,
    rateType: request.rateType,
    slippageBps,
    destinationAddress: request.destinationAddress,
    takerAddress: request.takerAddress,
    priceOf,
    signal: controller.signal,
  };

  let quotes: AggregatorQuote[];
  try {
    quotes = await Promise.all(ADAPTERS.map((adapter) => quoteWithFallback(adapter, ctx)));

    // Reverse quotes: converge the input until the best route's output lands
    // on the requested amount (within 10 bps). Two refinements are plenty —
    // the relationship is near-linear over this range.
    if (request.side === 'receive' && requestedAmount > 0n) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const candidates = quotes.filter((q) => !q.unavailableReason && BigInt(q.netOut) > 0n);
        if (candidates.length === 0) break;

        const bestOut = candidates.reduce(
          (max, q) => (BigInt(q.netOut) > max ? BigInt(q.netOut) : max),
          0n,
        );
        if (bestOut === 0n) break;

        const errorBps = ((requestedAmount - bestOut) * 10_000n) / requestedAmount;
        if (errorBps > -10n && errorBps < 10n) break;

        sendAmount = (sendAmount * requestedAmount) / bestOut;
        ctx.sellAmount = sendAmount;
        quotes = await Promise.all(ADAPTERS.map((adapter) => quoteWithFallback(adapter, ctx)));
      }
    }
  } finally {
    clearTimeout(deadline);
  }

  // Limits are checked against the converged amount, not the initial estimate.
  const sendUsd = checkLimits(sendAmount);

  const available = quotes.filter((q) => !q.unavailableReason && BigInt(q.netOut) > 0n);
  rank(available, to, priceOf);

  const best = available.find((q) => q.isBest);
  const anyLive = quotes.some((q) => q.source === 'live');

  if (!anyLive) {
    warnings.push(
      'No aggregator API is reachable or configured — showing simulated pricing. ' +
        'Set ZEROX_API_KEY / ONEINCH_API_KEY (KyberSwap, ParaSwap and THORChain need no key) for live quotes.',
    );
  }

  const receiveAmount = best ? BigInt(best.netOut) : 0n;
  const windowSeconds =
    request.rateType === 'fixed' ? FIXED_RATE_WINDOW_SECONDS : FLOAT_RATE_WINDOW_SECONDS;

  return {
    requestId: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    fromAssetId: from.id,
    toAssetId: to.id,
    sendAmount: sendAmount.toString(),
    receiveAmount: receiveAmount.toString(),
    rateType: request.rateType,
    unitRate: computeUnitRate(sendAmount, from, receiveAmount, to),
    sendUsd,
    receiveUsd: best?.netOutUsd ?? 0,
    quotes: [...available, ...quotes.filter((q) => q.unavailableReason)],
    best,
    expiresAt: Date.now() + windowSeconds * 1000,
    warnings,
    anyLive,
    priceMode: priceEntry.live ? 'live' : 'reference',
  };
}

async function quoteWithFallback(adapter: Adapter, ctx: AdapterContext): Promise<AggregatorQuote> {
  const support = adapter.supports(ctx.from, ctx.to);
  if (!support.ok) {
    return unavailable(adapter, support.reason);
  }

  if (FORCE_SIMULATION) {
    return simulateQuote(ctx, adapter.id);
  }

  try {
    return await adapter.quote(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const simulated = simulateQuote(ctx, adapter.id);
    simulated.notes = [
      ...(simulated.notes ?? []),
      `Live quote unavailable (${truncate(message, 90)}) — simulated`,
    ];
    return simulated;
  }
}

function unavailable(adapter: Adapter, reason: string): AggregatorQuote {
  return {
    aggregator: adapter.id,
    displayName: adapter.displayName,
    source: 'simulated',
    grossOut: '0',
    netOut: '0',
    minOut: '0',
    netOutUsd: 0,
    fee: {
      bps: 0,
      chargedOn: 'output',
      amount: '0',
      assetId: '',
      recipient: '',
      amountUsd: 0,
    },
    gasUsd: 0,
    priceImpactPct: 0,
    etaSeconds: 0,
    route: [],
    unavailableReason: reason,
  };
}

/**
 * Rank by value actually delivered to the user: the USD worth of the net
 * output minus the gas they must pay. Ranking on raw output alone would
 * promote a venue that wins by 3 cents while costing $4 more in gas.
 */
function rank(quotes: AggregatorQuote[], to: Asset, priceOf: (a: Asset) => number): void {
  if (quotes.length === 0) return;

  const scored = quotes
    .map((quote) => ({
      quote,
      score: toNumber(BigInt(quote.netOut), to.decimals) * priceOf(to) - quote.gasUsd,
    }))
    .sort((a, b) => b.score - a.score);

  for (const { quote } of scored) quote.isBest = false;

  const winner = scored[0];
  winner.quote.isBest = true;
  if (scored.length > 1) {
    winner.quote.advantageUsd = Math.max(0, winner.score - scored[1].score);
  }

  quotes.sort((a, b) => {
    if (a.isBest) return -1;
    if (b.isBest) return 1;
    return b.netOutUsd - b.gasUsd - (a.netOutUsd - a.gasUsd);
  });
}

function computeUnitRate(sendAmount: bigint, from: Asset, receiveAmount: bigint, to: Asset): number {
  const send = toNumber(sendAmount, from.decimals);
  const receive = toNumber(receiveAmount, to.decimals);
  if (send <= 0) return 0;
  return receive / send;
}

function emptyResponse(
  request: QuoteRequest,
  from: Asset,
  to: Asset,
  warnings: string[],
  priceLive: boolean,
): QuoteResponse {
  return {
    requestId: 'q_empty',
    fromAssetId: from.id,
    toAssetId: to.id,
    sendAmount: '0',
    receiveAmount: '0',
    rateType: request.rateType,
    unitRate: 0,
    sendUsd: 0,
    receiveUsd: 0,
    quotes: [],
    expiresAt: Date.now() + FLOAT_RATE_WINDOW_SECONDS * 1000,
    warnings,
    anyLive: false,
    priceMode: priceLive ? 'live' : 'reference',
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function getAdapter(id: AggregatorId): Adapter | undefined {
  return ADAPTER_BY_ID.get(id);
}

export function adapterCatalogue() {
  return ADAPTERS.map((adapter) => ({
    id: adapter.id,
    displayName: adapter.displayName,
    docsUrl: adapter.docsUrl,
    feeMechanism: adapter.feeMechanism,
  }));
}

export function chainCatalogue() {
  return Object.values(CHAINS).map((chain) => ({
    id: chain.id,
    name: chain.name,
    kind: chain.kind,
    chainId: chain.chainId,
  }));
}
