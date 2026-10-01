/**
 * Gas oracle.
 *
 * Ranking venues on `netOutUsd − gasUsd` is only as good as the gas number —
 * and the simulator previously used a static table honestly labelled as such.
 * This module upgrades the estimate in two stages:
 *
 *  1. If the operator exposes an RPC for the EVM chain (`EE_RPC_<CHAIN>`), we
 *     fetch `eth_gasPrice` (cached for 45 s) and convert it with the true
 *     native price the caller already resolved. Gas follows the market.
 *  2. Otherwise the static fallback table is used, unchanged.
 *
 * Non-EVM chains (Solana, UTXO…) always use the table — their fee mechanics
 * don't map to the simple gasPrice × units model and the table values are
 * sourced from observed network fees for this app's typical tx shapes.
 */

import { CHAINS, type ChainId } from '../shared/chains.js';
import { ASSETS, isNativeEvm, type Asset } from '../shared/assets.js';

/**
 * USD price of the chain's native asset, using the caller's price resolver —
 * the exact helper adapters use for the from-chain (aggregators/types) made
 * generic for any chain, so the gasUSD conversion never prices BNB gas in
 * ETH dollars or vice versa.
 */
export function nativeUsdPriceForChain(
  chainKey: string,
  priceOf: (asset: Asset) => number,
): number {
  const chain = CHAINS[chainKey as ChainId];
  if (!chain) return 0;
  const candidates = ASSETS.filter((a) => a.chain === chainKey);
  if (candidates.length === 0) return 0;
  const native =
    chain.kind === 'evm'
      ? candidates.find((a) => isNativeEvm(a))
      : // Non-EVM natives carry no contract address in the registry.
        candidates.find((a) => !a.address);
  return priceOf(native ?? candidates[0]) || 0;
}

/** Baseline gas cost in USD for a typical routed swap on each chain. */
export const STATIC_GAS_USD: Record<string, number> = {
  ethereum: 4.1,
  bsc: 0.28,
  polygon: 0.06,
  arbitrum: 0.14,
  base: 0.05,
  optimism: 0.08,
  avalanche: 0.22,
  solana: 0.0015,
  bitcoin: 2.4,
  litecoin: 0.04,
  dogecoin: 0.12,
  bitcoincash: 0.01,
  tron: 1.1,
  monero: 0.06,
  thorchain: 0.02,
  cosmos: 0.01,
  ripple: 0.001,
};

/** Typical gas units for an aggregator-routed same-chain swap. */
const TYPICAL_GAS_UNITS: Record<string, number> = {
  ethereum: 260_000,
  bsc: 300_000,
  polygon: 300_000,
  arbitrum: 180_000,
  base: 180_000,
  optimism: 200_000,
  avalanche: 300_000,
};

interface CacheEntry {
  wei: bigint;
  at: number;
}

const gasPriceCache = new Map<string, CacheEntry>();
const CACHE_MS = 45_000;
const RPC_TIMEOUT_MS = 2_500;

export function rpcForChain(chainKey: string): string | undefined {
  const envKey = `EE_RPC_${chainKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const url = process.env[envKey]?.trim();
  return url || undefined;
}

/**
 * Gas USD for a swap on `chainKey`, priced with the caller's live native
 * price (USD). Never throws — a sick RPC silently falls back to the table,
 * because a stale-but-sane number is better than a 500 during quoting.
 */
export async function chainGasUsd(chainKey: string, nativeUsdPrice: number): Promise<number> {
  const staticValue = STATIC_GAS_USD[chainKey] ?? 1.0;

  const chain = CHAINS[chainKey as ChainId];
  const units = TYPICAL_GAS_UNITS[chainKey];
  if (!chain || chain.kind !== 'evm' || units === undefined) return staticValue;

  // Refreshing the cache per quote burst would hammer the RPC; reuse stale
  // values within CACHE_MS instead of failing closed.
  const rpcUrl = rpcForChain(chainKey);
  if (!rpcUrl) return staticValue;

  const cached = gasPriceCache.get(chainKey);
  let wei: bigint | undefined;
  if (cached && Date.now() - cached.at < CACHE_MS) {
    wei = cached.wei;
  } else {
    wei = await fetchGasPriceWei(rpcUrl);
    if (wei === undefined) return staticValue;
    gasPriceCache.set(chainKey, { wei, at: Date.now() });
  }

  if (nativeUsdPrice <= 0) return staticValue;

  const usd = (Number(wei) / 1e18) * units * nativeUsdPrice;
  // Sanity clamp: anomalous RPC answers should never move ranking into
  // fiction. 10× the static table either way is the outer bound of sane.
  if (!Number.isFinite(usd) || usd <= 0) return staticValue;
  return Math.min(Math.max(usd, staticValue / 10), staticValue * 10);
}

async function fetchGasPriceWei(rpcUrl: string): Promise<bigint | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return undefined;
    const body = (await response.json()) as { result?: string };
    if (!body.result || typeof body.result !== 'string') return undefined;
    return BigInt(body.result);
  } catch {
    return undefined;
  }
}

/** Test hook. */
export function __resetGasOracle(): void {
  gasPriceCache.clear();
}
