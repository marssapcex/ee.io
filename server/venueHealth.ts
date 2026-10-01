/**
 * Venue health service.
 *
 * Raw net output is not the whole story when ranking aggregators: a venue
 * that has been failing or crawling for the last ten quotes is a worse pick
 * than one 0.1% behind with a perfect record. This module keeps a rolling
 * window per venue and derives three things from it:
 *
 * 1. Reliability % — success rate over the recent window, surfaced on each
 *    quote so the route board can mark venues that look flappy right now.
 * 2. Health — good / degraded / down, a human rollup of the same data.
 * 3. Circuit breaker — a venue that fails hard stops being CALLED for a
 *    cool-down. Without this, one dead upstream poisons every quote with its
 *    full timeout, and its latency stall degrades the whole fan-out.
 *
 * The breaker only skips the live call — the simulated fallback still fills
 * the row so the comparison stays visual — so it can never hide a venue, only
 * stop burning user time on it.
 */

import type { AggregatorId } from '../shared/types.js';

export type VenueHealth = 'good' | 'degraded' | 'down';

export interface VenueSnapshot {
  id: AggregatorId;
  /** Trials kept in the rolling window. */
  attempts: number;
  failures: number;
  successRatePct: number;
  avgLatencyMs: number;
  consecutiveFailures: number;
  health: VenueHealth;
  circuitOpen: boolean;
  /** Epoch ms when the circuit last opened (0 = never). */
  circuitOpenedAt: number;
}

interface Trial {
  ok: boolean;
  latencyMs: number;
  at: number;
}

const WINDOW = 30;
/** A hard strike: this many consecutive failures opens the circuit. */
const STRIKES = 3;
/** ...or a >=60% failure rate once at least this many trials exist. */
const MIN_TRIALS_FOR_RATE = 6;
const FAIL_RATE_OPEN = 0.6;
/** Half-open probe budget — how long a venue stays uncalled before a retry. */
const CIRCUIT_COOLDOWN_MS = 30_000;

const trials = new Map<AggregatorId, Trial[]>();
const circuits = new Map<AggregatorId, number>(); // openedAt

export function recordVenueTrial(id: AggregatorId, ok: boolean, latencyMs: number): void {
  const list = trials.get(id) ?? [];
  list.push({ ok, latencyMs, at: Date.now() });
  if (list.length > WINDOW) list.splice(0, list.length - WINDOW);
  trials.set(id, list);

  const snap = snapshotInternal(id);
  if (snap.circuitOpen && !circuits.has(id)) {
    circuits.set(id, Date.now());
  }
}

/**
 * True while a venue should not be called live. After the cool-down the
 * circuit goes half-open: we return false so exactly one probe goes through,
 * and recordVenueTrial() re-opens it if the venue is still broken.
 */
export function isCircuitOpen(id: AggregatorId): boolean {
  const openedAt = circuits.get(id);
  if (openedAt === undefined) return false;
  if (Date.now() - openedAt >= CIRCUIT_COOLDOWN_MS) return false;
  return true;
}

function snapshotInternal(id: AggregatorId): VenueSnapshot {
  const list = trials.get(id) ?? [];
  const attempts = list.length;
  const failures = list.filter((t) => !t.ok).length;
  const successRatePct = attempts === 0 ? 100 : ((attempts - failures) / attempts) * 100;

  const avgLatencyMs =
    attempts === 0 ? 0 : Math.round(list.reduce((sum, t) => sum + t.latencyMs, 0) / attempts);

  let consecutiveFailures = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].ok) break;
    consecutiveFailures += 1;
  }

  // A successful probe past the cool-down closes the circuit again.
  if (circuits.has(id) && list.length > 0 && list[list.length - 1].ok) {
    circuits.delete(id);
  }

  let circuitOpen = false;
  if (consecutiveFailures >= STRIKES) circuitOpen = true;
  if (attempts >= MIN_TRIALS_FOR_RATE && failures / attempts >= FAIL_RATE_OPEN) circuitOpen = true;
  if (circuits.has(id) && Date.now() - (circuits.get(id) ?? 0) < CIRCUIT_COOLDOWN_MS) {
    circuitOpen = true;
  }

  let health: VenueHealth = 'good';
  if (circuitOpen || (attempts >= 4 && successRatePct < 40)) health = 'down';
  else if (attempts >= 4 && successRatePct < 80) health = 'degraded';

  return {
    id,
    attempts,
    failures,
    successRatePct: Math.round(successRatePct * 10) / 10,
    avgLatencyMs,
    consecutiveFailures,
    health,
    circuitOpen,
    circuitOpenedAt: circuits.get(id) ?? 0,
  };
}

export function venueSnapshot(id: AggregatorId): VenueSnapshot {
  return snapshotInternal(id);
}

export function venueCatalogue(ids: readonly AggregatorId[]): VenueSnapshot[] {
  return ids.map(snapshotInternal);
}

/** Reliability for quote annotation: 100 until the venue has a track record. */
export function reliabilityPct(id: AggregatorId): number {
  return snapshotInternal(id).successRatePct;
}

export function venueHealthOf(id: AggregatorId): VenueHealth {
  return snapshotInternal(id).health;
}

/** Test hook: wipe all state. Production code must not call this. */
export function __resetVenueHealth(): void {
  trials.clear();
  circuits.clear();
}
