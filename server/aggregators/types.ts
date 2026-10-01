import { ASSETS, isNativeEvm, type Asset } from '../../shared/assets.js';
import type { AggregatorId, AggregatorQuote, FeePolicy, RateType } from '../../shared/types.js';

export interface AdapterContext {
  from: Asset;
  to: Asset;
  /** Base units of the input. */
  sellAmount: bigint;
  /** Effective affiliate fee for this trade. */
  feeBps: number;
  feePolicy: FeePolicy;
  rateType: RateType;
  slippageBps: number;
  destinationAddress?: string;
  takerAddress?: string;
  /** USD price lookup, already resolved for this request. */
  priceOf: (asset: Asset) => number;
  /**
   * Pre-resolved gas cost in USD for the destination chain, sourced from the
   * gas oracle (live `eth_gasPrice` when an RPC is configured, table
   * otherwise). Only the simulator consumes this — live adapters price gas
   * from their own upstream responses.
   */
  gasUsdOverride?: number;
  /** Aborts the upstream request when the overall quote deadline passes. */
  signal: AbortSignal;
}

export interface Adapter {
  id: AggregatorId;
  displayName: string;
  docsUrl: string;
  /** Fee mechanism summary shown in the UI. */
  feeMechanism: string;
  /** Cheap synchronous check so we don't fire doomed requests. */
  supports(from: Asset, to: Asset): { ok: true } | { ok: false; reason: string };
  /** Hit the real upstream API. Throws on failure; caller falls back. */
  quote(ctx: AdapterContext): Promise<AggregatorQuote>;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly aggregator: AggregatorId,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

/**
 * USD price of the gas token on the context's source chain. Gas must be
 * priced in the chain's native asset (BNB on BSC, AVAX on Avalanche…), not in
 * ETH — hard-coding an ETH price skews route ranking on every non-Ethereum
 * chain by an order of magnitude. Falls back to the input asset's price.
 */
export function nativeUsdPrice(ctx: AdapterContext): number {
  const native = ASSETS.find((a) => a.chain === ctx.from.chain && isNativeEvm(a));
  return native ? ctx.priceOf(native) : ctx.priceOf(ctx.from);
}

/** fetch with a hard timeout that also respects the caller's abort signal. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ data: T; latencyMs: number }> {
  const { timeoutMs = 6000, signal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  const started = Date.now();
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    const latencyMs = Date.now() - started;
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    try {
      return { data: JSON.parse(text) as T, latencyMs };
    } catch {
      throw new Error(`Malformed JSON from ${url}: ${text.slice(0, 120)}`);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
