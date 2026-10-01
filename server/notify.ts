/**
 * Status notification service.
 *
 * Instant-exchange users sit on one screen waiting for one number to change;
 * refreshing it with 2-second polling is wasteful and laggy. This module is
 * the real-time layer:
 *
 *  - A watcher scans the in-memory order/deposit stores on a short interval
 *    (their stores already lazily recompute derived status on read, so
 *    scanning IS the way transitions become visible).
 *  - Every transition fans out to two sinks: SSE subscribers of that order id
 *    (`GET /api/orders/:id/stream` etc.) and — when the record carries a
 *    `webhookUrl` — a one-shot POST to that URL, fire-and-forget, so a stuck
 *    webhook endpoint can never stall the watcher loop.
 *
 * The webhook payload deliberately includes the full public record: anything
 * a client can read via the REST endpoints, they can also receive over the
 * push channel — no private data, and idempotent content.
 */

import type { ServerResponse } from 'node:http';

import { listDeposits } from './depositProxy.js';
import { listOrders } from './orders.js';

const SCAN_INTERVAL_MS = 3_000;
const WEBHOOK_TIMEOUT_MS = 4_000;

type SseClient = { id: string; send: (payload: unknown) => void };

type Transport = (url: string, body: unknown, timeoutMs: number) => Promise<boolean>;

/** lastOrderStatuses holds the last-emitted status per id. Seeded lazily: a
 * record present before the watcher began never retro-fires a webhook. */
const lastStatuses = new Map<string, string>();
const sseClients = new Set<SseClient>();
let timer: ReturnType<typeof setInterval> | undefined;
let transport: Transport = defaultTransport;
/**
 * The very first pass only seeds the baseline. Without this, every pre-
 * existing pending order would blast a webhook burst the moment the server
 * boots or the watcher is (re)started.
 */
let seeded = false;

export function subscribeSse(id: string, res: ServerResponse): () => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // SSE replies must never be buffered by a proxy.
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  // Keepalive comment every 20s so intermediaries do not reap the socket.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ka\n\n');
    } catch {
      /* closed */
    }
  }, 20_000);
  heartbeat.unref?.();

  const client: SseClient = {
    id,
    send: (payload: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* socket died between scans — close handler cleans up */
      }
    },
  };
  sseClients.add(client);
  return () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  };
}

/**
 * One scan pass: recompute statuses for the recent window, emit on change.
 * Exported so tests can drive it synchronously instead of waiting on the timer.
 */
export async function scanNow(): Promise<number> {
  let transitions = 0;

  const seen = new Map<string, { status: string; record: unknown; webhookUrl?: string }>();
  for (const order of listOrders()) {
    seen.set(`order:${order.orderId}`, {
      status: order.status,
      record: order,
      webhookUrl: order.webhookUrl,
    });
  }
  for (const deposit of listDeposits()) {
    seen.set(`deposit:${deposit.depositId}`, {
      status: deposit.status,
      record: deposit,
      webhookUrl: deposit.webhookUrl,
    });
  }

  const isSeedPass = !seeded;
  seeded = true;

  for (const [key, current] of seen) {
    const previous = lastStatuses.get(key);
    if (previous === current.status) continue;
    lastStatuses.set(key, current.status);
    transitions += 1;
    if (isSeedPass) continue;

    const id = key.slice(key.indexOf(':') + 1);
    for (const client of sseClients) {
      if (client.id === id) client.send(current.record);
    }

    if (current.webhookUrl) {
      const body = JSON.stringify({ event: 'status', id, status: current.status, record: current.record });
      // Fire-and-forget by design; transport errors are logged quietly inside.
      void transport(current.webhookUrl, JSON.parse(body), WEBHOOK_TIMEOUT_MS);
    }
  }

  return transitions;
}

export function startNotifyWatcher(): void {
  if (timer) return;
  timer = setInterval(() => {
    void scanNow().catch((error) => {
      console.warn('[notify] scan failed:', error instanceof Error ? error.message : error);
    });
  }, SCAN_INTERVAL_MS);
  // The watcher must not keep a shutdown-pending process alive.
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
}

export function stopNotifyWatcher(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

async function defaultTransport(url: string, body: unknown, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ee.io-webhook/1' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timerId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Only http(s) URLs, sane length, no userinfo — the same basic hygiene any
 * webhook-taking service enforces before it starts POSTing to user input.
 */
export function validateWebhookUrl(raw: unknown): { ok: true; url: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'must be a URL string' };
  if (raw.length > 300) return { ok: false, reason: 'URL too long' };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a parseable URL' };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, reason: 'only http/https webhooks are accepted' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'userinfo is not allowed in webhook URLs' };
  }
  return { ok: true, url: parsed.toString() };
}

/** Test hooks: observe faked webhook deliveries, wipe watch state. */
export function __setTransport(mock: Transport): void {
  transport = mock;
}

export function __resetNotify(): void {
  stopNotifyWatcher();
  lastStatuses.clear();
  sseClients.clear();
  transport = defaultTransport;
  seeded = false;
}
