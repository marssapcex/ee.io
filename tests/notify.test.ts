import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetNotify,
  __setTransport,
  scanNow,
  validateWebhookUrl,
} from '../server/notify';
import { __resetOrders, createOrder, getOrder, markDeposited } from '../server/orders';
import { __resetDeposits } from '../server/depositProxy';
import type { ExecutionPlan } from '../shared/types';

function fakePlan(over: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    planId: 'plan_test',
    aggregator: 'kyberswap',
    displayName: 'KyberSwap Aggregator',
    source: 'simulated',
    fromAssetId: 'ETH.ETHEREUM',
    toAssetId: 'USDC.ETHEREUM',
    sendAmount: '1000000000000000000',
    receiveAmount: '3350000000',
    minReceiveAmount: '3300000000',
    destinationAddress: '0x2222222222222222222222222222222222222222',
    fee: {
      bps: 50,
      chargedOn: 'output',
      amount: '17000000',
      assetId: 'USDC.ETHEREUM',
      recipient: '0x7777777777777777777777777777777777777777',
      amountUsd: 17,
    },
    rateType: 'float',
    failureMode: 'revert-only',
    transaction: {
      kind: 'deposit',
      chain: 'ethereum',
      depositAddress: '0x4444444444444444444444444444444444444444',
      amount: '1000000000000000000',
      expiresAt: Date.now() + 600_000,
    },
    steps: [],
    custodyModel: 'test',
    references: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    ...over,
  };
}

describe('validateWebhookUrl', () => {
  it('accepts plain http(s) endpoints', () => {
    expect(validateWebhookUrl('https://hooks.example.com/orders').ok).toBe(true);
    expect(validateWebhookUrl('http://localhost:9000/hook?x=1').ok).toBe(true);
  });

  it('rejects garbage, non-http protocols and userinfo', () => {
    expect(validateWebhookUrl('not a url').ok).toBe(false);
    expect(validateWebhookUrl('ftp://example.com/x').ok).toBe(false);
    expect(validateWebhookUrl('https://user:pass@example.com/x').ok).toBe(false);
    expect(validateWebhookUrl(42).ok).toBe(false);
  });

  it('rejects oversized URLs', () => {
    expect(validateWebhookUrl(`https://example.com/${'a'.repeat(400)}`).ok).toBe(false);
  });
});

describe('notify watcher', () => {
  beforeEach(() => {
    __resetNotify();
    __resetOrders();
    __resetDeposits();
    __setTransport(async () => true);
  });

  it('fires a webhook exactly once per transition with the record payload', async () => {
    const delivered: { url: string; body: unknown }[] = [];
    __setTransport(async (url, body) => {
      delivered.push({ url, body });
      return true;
    });

    const order = createOrder(fakePlan(), { webhookUrl: 'https://hooks.example.com/x' });
    // First scan seeds the baseline — the webhook must NOT fire for a record
    // that existed before the watcher knew about it.
    await scanNow();
    expect(delivered).toHaveLength(0);

    // A real transition: deposit seen → detecting.
    markDeposited(order.orderId, '0x' + 'ab'.repeat(32));
    await scanNow();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].url).toBe('https://hooks.example.com/x');
    const payload = delivered[0].body as { event: string; id: string; status: string };
    expect(payload.event).toBe('status');
    expect(payload.id).toBe(order.orderId);
    expect(payload.status).toBe('detecting');

    // No change → no second webhook.
    await scanNow();
    expect(delivered).toHaveLength(1);
  });

  it('does not fire for records without a webhook', async () => {
    const delivered: unknown[] = [];
    __setTransport(async () => {
      delivered.push({});
      return true;
    });
    const order = createOrder(fakePlan());
    markDeposited(order.orderId);
    await scanNow();
    await scanNow();
    expect(delivered).toHaveLength(0);
    expect(getOrder(order.orderId)?.status).toBeDefined();
  });
});
