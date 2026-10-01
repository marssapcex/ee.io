/**
 * Partner API (integration commercial layer).
 *
 * The moat of the proven instant-exchange businesses (SideShift partner API,
 * ChangeNOW business accounts, FixedFloat merchant program) is not the swap
 * widget — it is letting wallet apps and dashboards embed the swap and take a
 * rev-share. This module is that layer for ee.io:
 *
 *  - Partners authenticate with an `x-api-key` header. Keys come from the
 *    environment (`EE_PARTNER_KEYS=partner1:sk_live_abc:2500,…`) where the
 *    trailing number is the partner's share of the operator's fee revenue in
 *    hundredths of a percent of the fee (2500 = the partner keeps 25% of the
 *    0.5% platform fee on every order they originate).
 *  - Quote requests are the public engine; deposits/orders created through
 *    the partner routes are tagged with the partner id, and the ledger below
 *    accrues volume + earned fee share for `/stats`.
 *  - A per-key token bucket caps abuse of the unauthenticated public API
 *    without hurting legitimately busy partners.
 *
 * Money is never moved to partners by this process — that accounting is an
 * operator settlement concern. The ledger exists so the numbers are exact,
 * verifiable and per-partner instead of eyeballed from logs.
 */

import type { DepositRecord, OrderRecord } from '../shared/types.js';

export interface PartnerConfig {
  id: string;
  apiKey: string;
  /** 0–10000; the partner's share of the operator's fee revenue. */
  shareBps: number;
}

export interface PartnerStats {
  partnerId: string;
  firstSeenAt: number;
  deposits: number;
  connectOrders: number;
  volumeUsd: number;
  /** Sum of deposit sendUsd at creation (gross trade volume). */
  earnedUsd: number;
  statuses: Record<string, number>;
}

const MAX_SHARE_BPS = 10_000;

interface LedgerEntry {
  firstSeenAt: number;
  deposits: number;
  connectOrders: number;
  volumeUsd: number;
  earnedUsd: number;
  statuses: Map<string, number>;
}

const ledger = new Map<string, LedgerEntry>();
const buckets = new Map<string, { tokens: number; refilledAt: number }>();

function parseEnvList(): PartnerConfig[] {
  const raw = process.env.EE_PARTNER_KEYS?.trim();
  if (!raw) return [];
  const out: PartnerConfig[] = [];
  for (const piece of raw.split(',')) {
    const parts = piece.trim().split(':');
    if (parts.length !== 3) {
      console.warn(`[partners] ignoring malformed EE_PARTNER_KEYS entry "${piece}" (want id:key:shareBps)`);
      continue;
    }
    const [id, apiKey, shareRaw] = parts;
    const shareBps = Number(shareRaw);
    if (!id || !apiKey || apiKey.length < 12 || !Number.isInteger(shareBps) || shareBps < 0 || shareBps > MAX_SHARE_BPS) {
      console.warn(`[partners] ignoring invalid partner entry "${id}"`);
      continue;
    }
    out.push({ id, apiKey, shareBps });
  }
  return out;
}

let cached: PartnerConfig[] | undefined;

export function partnerRegistry(): PartnerConfig[] {
  // Re-read on change so tests and ops edits take effect without a restart.
  if (cached === undefined) cached = parseEnvList();
  return cached;
}

export function authenticatePartner(apiKeyHeader: string | undefined): PartnerConfig | undefined {
  if (!apiKeyHeader) return undefined;
  return partnerRegistry().find((p) => p.apiKey === apiKeyHeader);
}

/** Token bucket: 60 requests per minute per key. */
export function allowPartnerRequest(partner: PartnerConfig): boolean {
  const now = Date.now();
  const capacity = 60;
  const bucket = buckets.get(partner.id) ?? { tokens: capacity, refilledAt: now };
  const gained = ((now - bucket.refilledAt) / 60_000) * capacity;
  const tokens = Math.min(capacity, bucket.tokens + gained);
  if (tokens < 1) {
    buckets.set(partner.id, { tokens, refilledAt: now });
    return false;
  }
  buckets.set(partner.id, { tokens: tokens - 1, refilledAt: now });
  return true;
}

function entryFor(partnerId: string): LedgerEntry {
  let entry = ledger.get(partnerId);
  if (!entry) {
    entry = { firstSeenAt: Date.now(), deposits: 0, connectOrders: 0, volumeUsd: 0, earnedUsd: 0, statuses: new Map() };
    ledger.set(partnerId, entry);
  }
  return entry;
}

/** Accrue volume + fee share when a partner-tagged order is created. */
export function accrueDeposit(partner: PartnerConfig, deposit: DepositRecord): void {
  const entry = entryFor(partner.id);
  entry.deposits += 1;
  entry.volumeUsd += deposit.sendUsd;
  entry.earnedUsd += (deposit.fee.amountUsd * partner.shareBps) / 10_000;
  entry.statuses.set(deposit.status, (entry.statuses.get(deposit.status) ?? 0) + 1);
}

export function accrueOrder(partner: PartnerConfig, order: OrderRecord): void {
  const entry = entryFor(partner.id);
  entry.connectOrders += 1;
  entry.earnedUsd += (order.plan.fee.amountUsd * partner.shareBps) / 10_000;
  entry.statuses.set(order.status, (entry.statuses.get(order.status) ?? 0) + 1);
}

export function partnerStats(partnerId: string): PartnerStats | undefined {
  const entry = ledger.get(partnerId);
  if (!entry) return undefined;
  return {
    partnerId,
    firstSeenAt: entry.firstSeenAt,
    deposits: entry.deposits,
    connectOrders: entry.connectOrders,
    volumeUsd: Math.round(entry.volumeUsd * 100) / 100,
    earnedUsd: Math.round(entry.earnedUsd * 10000) / 10000,
    statuses: Object.fromEntries(entry.statuses),
  };
}

/** Test hook. */
export function __resetPartners(): void {
  cached = undefined;
  ledger.clear();
  buckets.clear();
}
