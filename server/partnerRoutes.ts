/**
 * HTTP surface for the partner API — mounted at /api/partner/v1.
 *
 * Everything here wraps the PUBLIC engine and stores; the only difference is
 * authentication, tagging (partnerId lands on the record, webhooks work the
 * same way), and the ledger accrual that powers /stats.
 */

import { Router } from 'express';
import { requireAsset } from '../shared/assets.js';
import { buildQuote, defaultSlippageBps } from './quoteEngine.js';
import { buildExecutionPlan } from './executionPlanner.js';
import { createOrder } from './orders.js';
import { createDeposit, getDeposit } from './depositProxy.js';
import { validateWebhookUrl } from './notify.js';
import {
  accrueDeposit,
  accrueOrder,
  allowPartnerRequest,
  authenticatePartner,
  partnerStats,
  type PartnerConfig,
} from './partners.js';
import type express from 'express';

interface Authed extends express.Request {
  partner?: PartnerConfig;
}

function partnerAuth(req: Authed, res: express.Response, next: express.NextFunction): void {
  const partner = authenticatePartner(req.header('x-api-key'));
  if (!partner) {
    res.status(401).json({ error: 'Missing or unknown partner API key (x-api-key)' });
    return;
  }
  if (!allowPartnerRequest(partner)) {
    res.status(429).json({ error: 'Partner rate limit exceeded (60 req/min)' });
    return;
  }
  req.partner = partner;
  next();
}

export function partnerRouter(): Router {
  const router = Router();
  router.use(partnerAuth);

  /** Who am I — key echo so integrators never paste keys into dashboards. */
  router.get('/whoami', (req: Authed, res) => {
    res.json({ partnerId: req.partner!.id, shareBps: req.partner!.shareBps });
  });

  router.get('/stats', (req: Authed, res) => {
    res.json({ stats: partnerStats(req.partner!.id) ?? { partnerId: req.partner!.id, deposits: 0, connectOrders: 0, volumeUsd: 0, statuses: {} } });
  });

  /**
   * Create a tagged deposit order. The tag does three jobs: revenue accrual,
   * partner attribution in stats, and the webhook stays partner-controlled.
   */
  router.post('/deposit', async (req: Authed, res) => {
    const webhookCheck = req.body?.webhookUrl === undefined
      ? { ok: true as const, url: undefined }
      : validateWebhookUrl(req.body.webhookUrl);
    if (!webhookCheck.ok) {
      res.status(400).json({ error: `webhookUrl rejected: ${webhookCheck.reason}` });
      return;
    }
    try {
      const deposit = await createDeposit({
        fromAssetId: String(req.body?.fromAssetId ?? ''),
        toAssetId: String(req.body?.toAssetId ?? ''),
        amount: String(req.body?.amount ?? ''),
        destinationAddress: String(req.body?.destinationAddress ?? ''),
        aggregator: req.body?.aggregator,
        rateType: req.body?.rateType,
        slippageBps: req.body?.slippageBps,
        webhookUrl: webhookCheck.url,
        partnerId: req.partner!.id,
      });
      accrueDeposit(req.partner!, deposit);
      res.json({ deposit });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Deposit failed' });
    }
  });

  router.get('/deposit/:id', (req: Authed, res) => {
    const record = getDeposit(req.params.id);
    if (!record || record.partnerId !== req.partner!.id) {
      res.status(404).json({ error: 'Deposit not found' });
      return;
    }
    res.json({ deposit: record });
  });

  /** Connect-wallet plan creation, partner-tagged. */
  router.post('/plan', async (req: Authed, res) => {
    const webhookCheck = req.body?.webhookUrl === undefined
      ? { ok: true as const, url: undefined }
      : validateWebhookUrl(req.body.webhookUrl);
    if (!webhookCheck.ok) {
      res.status(400).json({ error: `webhookUrl rejected: ${webhookCheck.reason}` });
      return;
    }
    try {
      const from = requireAsset(String(req.body?.fromAssetId ?? ''));
      const to = requireAsset(String(req.body?.toAssetId ?? ''));
      const rateType = req.body?.rateType === 'fixed' ? 'fixed' : 'float';
      const slippageBps =
        typeof req.body?.slippageBps === 'number'
          ? req.body.slippageBps
          : defaultSlippageBps(rateType, from, to);
      const sendAmount = String(req.body?.sendAmount ?? '');

      const quoteResponse = await buildQuote({
        fromAssetId: from.id,
        toAssetId: to.id,
        amount: sendAmount,
        side: 'send',
        rateType,
        destinationAddress: String(req.body?.destinationAddress ?? ''),
        takerAddress: req.body?.takerAddress,
        slippageBps,
      });
      const chosen =
        quoteResponse.quotes.find(
          (q) => q.aggregator === req.body?.aggregator && !q.unavailableReason,
        ) ?? quoteResponse.best;
      if (!chosen) {
        res.status(400).json({ error: 'No executable route for this pair' });
        return;
      }

      const plan = await buildExecutionPlan({
        quote: chosen,
        fromAssetId: from.id,
        toAssetId: to.id,
        sendAmount,
        destinationAddress: String(req.body?.destinationAddress ?? ''),
        takerAddress: req.body?.takerAddress,
        slippageBps,
        expiresAt: quoteResponse.expiresAt,
        rateType,
      });
      const order = createOrder(plan, { webhookUrl: webhookCheck.url, partnerId: req.partner!.id });
      accrueOrder(req.partner!, order);
      res.json({ plan, order });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Plan failed' });
    }
  });

  return router;
}
