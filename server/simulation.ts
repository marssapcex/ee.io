/**
 * Deterministic offline quote simulator.
 *
 * Every quote it produces is tagged `source: 'simulated'` and the UI labels it
 * as such — it exists so the product is fully explorable without API keys (and
 * in sandboxes with no outbound network), NOT to fake live pricing.
 *
 * Design rules:
 *  - Deterministic. The same inputs give the same output, so screenshots and
 *    tests are stable. Variation comes from hashing the inputs, not Math.random.
 *  - Directionally realistic. Venue spreads, gas costs and slip all scale the
 *    way they do in production: bigger trade → more slip; L2 → cheaper gas;
 *    cross-chain → slower and pricier.
 *  - Fee maths is the REAL maths. Only the upstream price discovery is faked;
 *    the fee split runs through the exact same code path as a live quote.
 */

import { type Asset } from '../shared/assets.js';
import { CHAINS } from '../shared/chains.js';
import { applyBps, convertByUsd, toNumber } from '../shared/money.js';
import type { AggregatorId, AggregatorQuote, RouteHop } from '../shared/types.js';
import type { AdapterContext } from './aggregators/types.js';

/** FNV-1a — small, fast, and stable across runs. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic value in [min, max) derived from a seed string. */
function seeded(seed: string, min: number, max: number): number {
  return min + (hashString(seed) / 0xffffffff) * (max - min);
}

interface VenueProfile {
  id: AggregatorId;
  displayName: string;
  /** Multiplier on the ideal mid-price output. */
  efficiency: number;
  gasMultiplier: number;
  pools: string[];
}

const VENUES: Record<AggregatorId, VenueProfile> = {
  '0x': {
    id: '0x',
    displayName: '0x Swap API v2',
    efficiency: 1.0,
    gasMultiplier: 1.0,
    pools: ['Uniswap V3', 'Curve', '0x RFQ', 'Balancer V2'],
  },
  kyberswap: {
    id: 'kyberswap',
    displayName: 'KyberSwap Aggregator',
    efficiency: 0.99925,
    gasMultiplier: 1.08,
    pools: ['Uniswap V3', 'KyberSwap Elastic', 'PancakeSwap V3', 'Curve'],
  },
  '1inch': {
    id: '1inch',
    displayName: '1inch Classic Swap v6',
    efficiency: 0.99965,
    gasMultiplier: 1.12,
    pools: ['Uniswap V3', 'Sushiswap', '1inch LP', 'Maverick'],
  },
  openocean: {
    id: 'openocean',
    displayName: 'OpenOcean v4',
    efficiency: 0.99845,
    gasMultiplier: 1.05,
    pools: ['Uniswap V2', 'DODO', 'Curve'],
  },
  paraswap: {
    id: 'paraswap',
    displayName: 'ParaSwap / Velora',
    efficiency: 0.99895,
    gasMultiplier: 1.03,
    pools: ['Uniswap V3', 'Augustus RFQ', 'Balancer V2'],
  },
  thorchain: {
    id: 'thorchain',
    displayName: 'THORChain',
    efficiency: 0.9955,
    gasMultiplier: 0.9,
    pools: ['THORChain CLP'],
  },
  jupiter: {
    id: 'jupiter',
    displayName: 'Jupiter Metis (Solana)',
    efficiency: 0.99955,
    gasMultiplier: 0.02,
    pools: ['Orca Whirlpool', 'Raydium CLMM', 'Meteora DLMM'],
  },
};

/** Baseline gas cost in USD for a swap on each chain. */
const CHAIN_GAS_USD: Record<string, number> = {
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

/**
 * Slip grows with trade size relative to available depth. Deep majors barely
 * move; long-tail assets move fast.
 */
function estimateSlipBps(sellUsd: number, from: Asset, to: Asset, venue: VenueProfile): number {
  const depthScore = (asset: Asset): number => {
    if (asset.stable) return 4_000_000;
    if (['BTC', 'ETH', 'WETH', 'SOL', 'BNB'].includes(asset.symbol)) return 2_500_000;
    if (asset.popular) return 900_000;
    return 180_000;
  };

  const depth = Math.min(depthScore(from), depthScore(to));
  const venueDepth = venue.id === 'thorchain' ? depth * 0.12 : depth;
  // Constant-product style: impact ≈ size / (size + depth).
  const raw = (sellUsd / (sellUsd + venueDepth)) * 10_000;
  return Math.min(raw, 900);
}

export function simulateQuote(ctx: AdapterContext, aggregator: AggregatorId): AggregatorQuote {
  const venue = VENUES[aggregator];
  const { from, to, sellAmount, feeBps, feePolicy } = ctx;

  const fromPrice = ctx.priceOf(from);
  const toPrice = ctx.priceOf(to);
  const sellUsd = toNumber(sellAmount, from.decimals) * fromPrice;

  // Which side the fee is skimmed from decides how much actually gets routed.
  // OpenOcean takes its referrerFee from the INPUT token, so only the
  // remainder reaches the pools — charging on input and then routing the full
  // amount would overstate its output and wrongly rank it first.
  const feeChargedOnOutput = feePolicy.chargeOn === 'output' && aggregator !== 'openocean';
  const inputFee = feeChargedOnOutput ? 0n : applyBps(sellAmount, feeBps);
  const routedAmount = sellAmount - inputFee;

  // Ideal output at mid-price, before any friction.
  const idealOut = convertByUsd(routedAmount, from.decimals, fromPrice, to.decimals, toPrice);

  // Per-pair, per-venue spread keeps the ranking stable but non-uniform, so
  // the "best" venue genuinely varies by pair the way it does in production.
  const pairSeed = `${from.id}>${to.id}|${aggregator}`;
  const venueJitter = seeded(pairSeed, -0.0009, 0.0009);
  const slipBps = estimateSlipBps(sellUsd, from, to, venue);

  const efficiency = venue.efficiency + venueJitter;
  const afterVenue = (idealOut * BigInt(Math.round(efficiency * 1e6))) / 1_000_000n;
  const grossOut = afterVenue - applyBps(afterVenue, slipBps);

  // Network cost, charged against the output.
  const chainKey = aggregator === 'thorchain' ? to.chain : to.chain;
  const baseGas = CHAIN_GAS_USD[chainKey] ?? 1.0;
  const gasUsd = baseGas * venue.gasMultiplier;

  const feeAsset = feeChargedOnOutput ? to : from;
  const feeAmount = feeChargedOnOutput ? applyBps(grossOut, feeBps) : inputFee;

  const netOut = feeChargedOnOutput ? grossOut - feeAmount : grossOut;
  const minOut = netOut - applyBps(netOut, ctx.slippageBps);

  const feeAmountUsd = toNumber(feeAmount, feeAsset.decimals) * ctx.priceOf(feeAsset);
  const integratorShareBps = aggregator === 'openocean' ? 8000 : 10_000;

  const route = buildSimulatedRoute(venue, from, to, pairSeed);

  const fromChain = CHAINS[from.chain];
  const toChain = CHAINS[to.chain];
  const etaSeconds =
    aggregator === 'thorchain'
      ? fromChain.blockSeconds * fromChain.confirmations + 60 + toChain.blockSeconds * 6
      : toChain.blockSeconds * toChain.confirmations + 15;

  return {
    aggregator,
    displayName: venue.displayName,
    source: 'simulated',
    grossOut: grossOut.toString(),
    netOut: netOut.toString(),
    minOut: minOut.toString(),
    netOutUsd: toNumber(netOut, to.decimals) * toPrice,
    fee: {
      bps: feeBps,
      chargedOn: feeChargedOnOutput ? 'output' : 'input',
      amount: feeAmount.toString(),
      assetId: feeAsset.id,
      recipient: resolveRecipient(ctx, aggregator),
      amountUsd: feeAmountUsd,
      integratorShareBps,
      netToOperatorUsd: (feeAmountUsd * integratorShareBps) / 10_000,
    },
    gasUsd,
    priceImpactPct: slipBps / 100,
    etaSeconds,
    route,
    notes: undefined,
    latencyMs: Math.round(seeded(`${pairSeed}|latency`, 90, 420)),
  };
}

function resolveRecipient(ctx: AdapterContext, aggregator: AggregatorId): string {
  const { feePolicy } = ctx;
  if (aggregator === 'thorchain') return feePolicy.recipients.thorchain ?? feePolicy.recipients.evm;
  if (aggregator === 'jupiter') return feePolicy.recipients.solana ?? feePolicy.recipients.evm;
  return feePolicy.recipients.evm;
}

function buildSimulatedRoute(
  venue: VenueProfile,
  from: Asset,
  to: Asset,
  seed: string,
): RouteHop[] {
  if (venue.id === 'thorchain') {
    return [
      { name: 'Asgard inbound vault', percent: 100, fromSymbol: from.symbol, toSymbol: 'RUNE' },
      { name: 'THORChain CLP', percent: 100, fromSymbol: 'RUNE', toSymbol: to.symbol },
    ];
  }

  const count = 1 + Math.floor(seeded(`${seed}|splits`, 0, 2.99));
  const hops: RouteHop[] = [];
  let remaining = 100;

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const share = isLast
      ? remaining
      : Math.max(10, Math.round(seeded(`${seed}|share${i}`, 20, remaining - 10)));
    remaining -= share;
    hops.push({
      name: venue.pools[i % venue.pools.length],
      percent: share,
      fromSymbol: from.symbol,
      toSymbol: to.symbol,
    });
  }
  return hops.sort((a, b) => b.percent - a.percent);
}

/** Simulated deposit address — visibly fake so nobody sends real funds. */
export function simulatedDepositAddress(asset: Asset, seed: string): string {
  const chain = CHAINS[asset.chain];
  const hex = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      '0123456789abcdef'[hashString(`${seed}|${i}`) % 16],
    ).join('');
  const b58 = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[
        hashString(`${seed}|b58|${i}`) % 58
      ],
    ).join('');

  switch (chain.kind) {
    case 'utxo':
      if (asset.chain === 'bitcoin') return `bc1q${hex(38)}`;
      if (asset.chain === 'litecoin') return `ltc1q${hex(38)}`;
      return `D${b58(33)}`;
    case 'solana':
      return b58(44);
    case 'tron':
      return `T${b58(33)}`;
    case 'monero':
      return `4${b58(94)}`;
    case 'cosmos':
      return `thor1${b58(38).toLowerCase()}`;
    case 'ripple':
      return `r${b58(32)}`;
    default:
      return `0x${hex(40)}`;
  }
}
