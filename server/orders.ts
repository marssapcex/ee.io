/**
 * In-memory order tracking.
 *
 * An "order" here is only a *view* over a public on-chain process — ee.io has
 * no funds to reconcile, so losing this store loses nothing but UI state. That
 * is exactly the property a custodial exchange cannot have.
 *
 * In production this would be backed by chain watchers (mempool.space,
 * THORChain /tx/status, an EVM RPC). The state machine below advances on real
 * timing characteristics of each chain so the UI is exercised end to end.
 */

import { requireAsset } from '../shared/assets.js';
import { CHAINS } from '../shared/chains.js';
import type { ExecutionPlan, OrderRecord } from '../shared/types.js';

const orders = new Map<string, OrderRecord>();
const MAX_ORDERS = 500;

export function createOrder(plan: ExecutionPlan): OrderRecord {
  const from = requireAsset(plan.fromAssetId);
  const chain = CHAINS[from.chain];

  const order: OrderRecord = {
    orderId: `EE-${randomDigits(6)}`,
    createdAt: Date.now(),
    expiresAt: plan.expiresAt,
    status: 'awaiting_deposit',
    plan,
    confirmations: 0,
    requiredConfirmations: chain.confirmations,
  };

  if (orders.size >= MAX_ORDERS) {
    const oldest = [...orders.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) orders.delete(oldest.orderId);
  }

  orders.set(order.orderId, order);
  return order;
}

export function getOrder(orderId: string): OrderRecord | undefined {
  const order = orders.get(orderId);
  if (!order) return undefined;
  return advance(order);
}

export function listOrders(): OrderRecord[] {
  return [...orders.values()]
    .map(advance)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
}

/**
 * Simulate the deposit being seen. In production this is a chain watcher
 * callback; exposing it as an endpoint lets the whole flow be demonstrated
 * without moving real money.
 */
export function markDeposited(orderId: string, txHash?: string): OrderRecord | undefined {
  const order = orders.get(orderId);
  if (!order) return undefined;
  if (order.status === 'awaiting_deposit') {
    order.status = 'detecting';
    order.inboundTxHash = txHash ?? `0x${randomHex(64)}`;
    // Anchor the simulated progression to the moment of deposit.
    (order as OrderRecord & { depositedAt?: number }).depositedAt = Date.now();
  }
  return advance(order);
}

interface TimedOrder extends OrderRecord {
  depositedAt?: number;
}

function advance(order: OrderRecord): OrderRecord {
  const timed = order as TimedOrder;
  const from = requireAsset(order.plan.fromAssetId);
  const chain = CHAINS[from.chain];

  if (order.status === 'awaiting_deposit') {
    if (Date.now() > order.expiresAt) order.status = 'expired';
    return order;
  }
  if (order.status === 'completed' || order.status === 'expired' || order.status === 'refunded') {
    return order;
  }

  const elapsed = (Date.now() - (timed.depositedAt ?? order.createdAt)) / 1000;

  // Confirmation pacing mirrors the source chain's real block time.
  const perConfirmation = Math.max(chain.blockSeconds, 1);
  const confirmations = Math.min(
    order.requiredConfirmations,
    Math.floor(elapsed / perConfirmation),
  );
  order.confirmations = confirmations;

  const confirmSeconds = order.requiredConfirmations * perConfirmation;
  const swapSeconds = order.plan.aggregator === 'thorchain' ? 45 : 14;
  const settleSeconds = 12;

  if (elapsed < 3) order.status = 'detecting';
  else if (elapsed < confirmSeconds) order.status = 'confirming';
  else if (elapsed < confirmSeconds + swapSeconds) order.status = 'swapping';
  else if (elapsed < confirmSeconds + swapSeconds + settleSeconds) order.status = 'settling';
  else {
    order.status = 'completed';
    order.outboundTxHash ??= `0x${randomHex(64)}`;
  }

  return order;
}

function randomDigits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function randomHex(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return out;
}
