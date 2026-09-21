/**
 * USD price oracle with a short TTL cache.
 *
 * Prices only affect display values and the simulator — never the amounts
 * encoded into a transaction, which always come from the aggregator itself.
 * So a stale price is a cosmetic problem, not a fund-safety one.
 */

import { ASSETS, type Asset } from '../shared/assets.js';

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  WETH: 'weth',
  WBTC: 'wrapped-bitcoin',
  XMR: 'monero',
  SOL: 'solana',
  LTC: 'litecoin',
  DOGE: 'dogecoin',
  BCH: 'bitcoin-cash',
  RUNE: 'thorchain',
  ATOM: 'cosmos',
  XRP: 'ripple',
  TRX: 'tron',
  BNB: 'binancecoin',
  POL: 'polygon-ecosystem-token',
  AVAX: 'avalanche-2',
  ARB: 'arbitrum',
  OP: 'optimism',
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
  LINK: 'chainlink',
  UNI: 'uniswap',
  AAVE: 'aave',
  PEPE: 'pepe',
  SHIB: 'shiba-inu',
  CAKE: 'pancakeswap-token',
  JUP: 'jupiter-exchange-solana',
};

const TTL_MS = 30_000;

interface CacheEntry {
  prices: Map<string, number>;
  fetchedAt: number;
  live: boolean;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<CacheEntry> | null = null;

function referencePrices(): Map<string, number> {
  const map = new Map<string, number>();
  for (const asset of ASSETS) {
    if (!map.has(asset.symbol)) map.set(asset.symbol, asset.referenceUsd);
  }
  return map;
}

async function fetchLivePrices(): Promise<CacheEntry> {
  const ids = [...new Set(Object.values(COINGECKO_IDS))].join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: process.env.COINGECKO_API_KEY
        ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }
        : undefined,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = (await response.json()) as Record<string, { usd: number }>;
    const prices = referencePrices();
    let matched = 0;

    for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
      const usd = body[id]?.usd;
      if (typeof usd === 'number' && usd > 0) {
        prices.set(symbol, usd);
        matched++;
      }
    }
    if (matched === 0) throw new Error('No prices matched');

    return { prices, fetchedAt: Date.now(), live: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function getPrices(): Promise<CacheEntry> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = fetchLivePrices()
    .catch((error) => {
      // Offline or rate-limited: fall back to reference prices. The response
      // reports priceMode:'reference' so the UI can say so.
      if (!cache) {
        console.warn(`[prices] falling back to reference prices: ${(error as Error).message}`);
      }
      return { prices: referencePrices(), fetchedAt: Date.now(), live: false };
    })
    .then((entry) => {
      cache = entry;
      inFlight = null;
      return entry;
    });

  return inFlight;
}

export function priceLookup(entry: CacheEntry): (asset: Asset) => number {
  return (asset: Asset) => {
    if (asset.stable) return entry.prices.get(asset.symbol) ?? 1;
    return entry.prices.get(asset.symbol) ?? asset.referenceUsd;
  };
}
