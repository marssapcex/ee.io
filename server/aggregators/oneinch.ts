/**
 * 1inch adapter (Classic Swap v6).
 *
 * Fee params on /swap and /quote:
 *   fee      — partner fee as a PERCENT (not bps), 0–3
 *   referrer — address that receives the fee; required whenever fee > 0
 *
 * For Fusion (intent/RFQ) and Fusion+ (cross-chain) the SDK instead takes a
 * structured `integratorFee: { receiver, value: Bps }`, where the response's
 * `share` says how much of that fee the integrator keeps vs the protocol.
 *
 * Docs: https://portal.1inch.dev/documentation/apis/swap/classic-swap
 * Auth: Bearer token from portal.1inch.dev (free tier available).
 */

import { isEvmAsset, type Asset } from '../../shared/assets.js';
import { CHAINS } from '../../shared/chains.js';
import { toNumber } from '../../shared/money.js';
import type { AggregatorQuote, RouteHop } from '../../shared/types.js';
import { AdapterError, fetchJson, type Adapter, type AdapterContext } from './types.js';

const BASE_URL = 'https://api.1inch.dev/swap/v6.1';

/** 1inch caps the partner fee at 3%. */
export const ONEINCH_MAX_FEE_PERCENT = 3;

interface OneInchQuoteResponse {
  dstAmount: string;
  gas?: number;
  protocols?: { name: string; part: number; fromTokenAddress: string; toTokenAddress: string }[][][];
  tx?: { from: string; to: string; data: string; value: string; gas: number; gasPrice: string };
}

export const oneInchAdapter: Adapter = {
  id: '1inch',
  displayName: '1inch Classic Swap v6',
  docsUrl: 'https://portal.1inch.dev/documentation/apis/swap/classic-swap/quick-start',
  feeMechanism: 'fee (percent, max 3) + referrer address',

  supports(from: Asset, to: Asset) {
    if (!isEvmAsset(from) || !isEvmAsset(to)) {
      return { ok: false as const, reason: 'Classic Swap is EVM-only' };
    }
    if (from.chain !== to.chain) {
      return { ok: false as const, reason: 'Use Fusion+ for cross-chain' };
    }
    return { ok: true as const };
  },

  async quote(ctx: AdapterContext): Promise<AggregatorQuote> {
    const { from, to, sellAmount, feeBps, feePolicy } = ctx;
    const chain = CHAINS[from.chain];

    const apiKey = process.env.ONEINCH_API_KEY;
    if (!apiKey) throw new AdapterError('ONEINCH_API_KEY is not configured', '1inch');

    // 1inch takes a percent, not bps.
    const feePercent = Math.min(feeBps / 100, ONEINCH_MAX_FEE_PERCENT);

    const params = new URLSearchParams({
      src: from.address!,
      dst: to.address!,
      amount: sellAmount.toString(),
      includeGas: 'true',
      includeProtocols: 'true',
      fee: feePercent.toFixed(3),
      referrer: feePolicy.recipients.evm,
    });

    // /swap needs a `from` address and returns calldata; /quote is indicative.
    const useSwap = Boolean(ctx.takerAddress);
    if (ctx.takerAddress) {
      params.set('from', ctx.takerAddress);
      params.set('origin', ctx.takerAddress);
      params.set('slippage', String(ctx.slippageBps / 100));
      if (ctx.destinationAddress) params.set('receiver', ctx.destinationAddress);
    }

    const url = `${BASE_URL}/${chain.chainId}/${useSwap ? 'swap' : 'quote'}?${params.toString()}`;
    const { data, latencyMs } = await fetchJson<OneInchQuoteResponse>(url, {
      headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: ctx.signal,
    });

    // 1inch reports dstAmount already net of the partner fee.
    const netOut = BigInt(data.dstAmount);
    const feeAmount = (netOut * BigInt(Math.round(feePercent * 100))) / 10_000n;
    const minOut = (netOut * BigInt(10_000 - ctx.slippageBps)) / 10_000n;

    const route: RouteHop[] = flattenProtocols(data.protocols, from.symbol, to.symbol);

    const sellUsd = toNumber(sellAmount, from.decimals) * ctx.priceOf(from);
    const buyUsd = toNumber(netOut, to.decimals) * ctx.priceOf(to);
    const feeAmountUsd = toNumber(feeAmount, to.decimals) * ctx.priceOf(to);

    return {
      aggregator: '1inch',
      displayName: this.displayName,
      source: 'live',
      grossOut: (netOut + feeAmount).toString(),
      netOut: netOut.toString(),
      minOut: minOut.toString(),
      netOutUsd: buyUsd,
      fee: {
        bps: Math.round(feePercent * 100),
        chargedOn: 'output',
        amount: feeAmount.toString(),
        assetId: to.id,
        recipient: feePolicy.recipients.evm,
        amountUsd: feeAmountUsd,
        integratorShareBps: 10_000,
        netToOperatorUsd: feeAmountUsd,
      },
      gasUsd: data.gas ? estimateGasUsd(data.gas, ctx) : 0,
      priceImpactPct: sellUsd > 0 ? Math.max(0, ((sellUsd - buyUsd) / sellUsd) * 100) : 0,
      etaSeconds: chain.blockSeconds * chain.confirmations + 15,
      route,
      notes: useSwap ? undefined : ['Indicative /quote — connect a wallet for calldata'],
      latencyMs,
      requestPreview: { method: 'GET', url },
    };
  },
};

function flattenProtocols(
  protocols: OneInchQuoteResponse['protocols'],
  fromSymbol: string,
  toSymbol: string,
): RouteHop[] {
  if (!protocols?.length) return [];
  const hops: RouteHop[] = [];
  for (const path of protocols) {
    for (const parallel of path) {
      for (const hop of parallel) {
        hops.push({
          name: hop.name,
          percent: hop.part,
          fromSymbol,
          toSymbol,
        });
      }
    }
  }
  // Collapse duplicates so the UI shows "Uniswap V3 62%" once.
  const merged = new Map<string, RouteHop>();
  for (const hop of hops) {
    const existing = merged.get(hop.name);
    if (existing) existing.percent += hop.percent;
    else merged.set(hop.name, { ...hop });
  }
  return [...merged.values()].sort((a, b) => b.percent - a.percent).slice(0, 6);
}

function estimateGasUsd(gas: number, ctx: AdapterContext): number {
  // Without a gas price from the API, assume a mid-range tip; the UI labels
  // this as an estimate.
  const GWEI = 12n;
  const weiCost = BigInt(gas) * GWEI * 1_000_000_000n;
  const chain = CHAINS[ctx.from.chain];
  const nativePrice = chain.nativeSymbol === 'ETH' ? ctx.priceOf(ctx.from) : ctx.priceOf(ctx.from);
  return toNumber(weiCost, 18) * (chain.nativeSymbol === 'ETH' ? 3420 : nativePrice);
}
