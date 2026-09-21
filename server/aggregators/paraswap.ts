/**
 * ParaSwap / Velora adapter.
 *
 * Fee params:
 *   partnerAddress — address entitled to the fee
 *   partnerFeeBps  — basis points (max 200 on Delta orders; classic allows more)
 *   isDirectFeeTransfer — send fees straight to the partner instead of
 *                         registering them on the FeeClaimer contract
 *   takeSurplus    — optionally capture positive slippage instead
 *
 * Without `isDirectFeeTransfer` the operator must periodically claim from the
 * FeeClaimer contract, which is a custody-free but manual step — we default to
 * direct transfer so revenue needs no follow-up transaction.
 *
 * Docs: https://developers.velora.xyz/api/velora-api
 */

import { isEvmAsset, type Asset } from '../../shared/assets.js';
import { CHAINS } from '../../shared/chains.js';
import { toNumber } from '../../shared/money.js';
import type { AggregatorQuote, RouteHop } from '../../shared/types.js';
import { AdapterError, fetchJson, type Adapter, type AdapterContext } from './types.js';

const BASE_URL = 'https://api.paraswap.io';

export const PARASWAP_MAX_FEE_BPS = 200;

interface ParaSwapPricesResponse {
  priceRoute?: {
    srcToken: string;
    srcDecimals: number;
    srcAmount: string;
    destToken: string;
    destDecimals: number;
    destAmount: string;
    gasCostUSD?: string;
    gasCost?: string;
    srcUSD?: string;
    destUSD?: string;
    partner?: string;
    partnerFee?: number;
    bestRoute?: {
      percent: number;
      swaps?: {
        srcToken: string;
        destToken: string;
        swapExchanges?: { exchange: string; percent: number }[];
      }[];
    }[];
  };
  error?: string;
}

export const paraSwapAdapter: Adapter = {
  id: 'paraswap',
  displayName: 'ParaSwap / Velora',
  docsUrl: 'https://developers.velora.xyz/api/velora-api',
  feeMechanism: 'partnerAddress + partnerFeeBps (+ isDirectFeeTransfer)',

  supports(from: Asset, to: Asset) {
    if (!isEvmAsset(from) || !isEvmAsset(to)) {
      return { ok: false as const, reason: 'ParaSwap is EVM-only' };
    }
    if (from.chain !== to.chain) {
      return { ok: false as const, reason: 'Single-chain routing only' };
    }
    return { ok: true as const };
  },

  async quote(ctx: AdapterContext): Promise<AggregatorQuote> {
    const { from, to, sellAmount, feeBps, feePolicy } = ctx;
    const chain = CHAINS[from.chain];
    const effectiveBps = Math.min(feeBps, PARASWAP_MAX_FEE_BPS);

    const params = new URLSearchParams({
      srcToken: from.address!,
      destToken: to.address!,
      amount: sellAmount.toString(),
      srcDecimals: String(from.decimals),
      destDecimals: String(to.decimals),
      side: 'SELL',
      network: String(chain.chainId),
      version: '6.2',
      partner: feePolicy.clientId,
      partnerAddress: feePolicy.recipients.evm,
      partnerFeeBps: String(effectiveBps),
      isDirectFeeTransfer: 'true',
      takeSurplus: 'true',
    });
    if (ctx.takerAddress) params.set('userAddress', ctx.takerAddress);

    const url = `${BASE_URL}/prices?${params.toString()}`;
    const { data, latencyMs } = await fetchJson<ParaSwapPricesResponse>(url, {
      signal: ctx.signal,
    });

    if (data.error || !data.priceRoute) {
      throw new AdapterError(data.error ?? 'No price route', 'paraswap');
    }

    const route = data.priceRoute;
    const grossOut = BigInt(route.destAmount);
    const feeAmount = (grossOut * BigInt(effectiveBps)) / 10_000n;
    const netOut = grossOut - feeAmount;
    const minOut = (netOut * BigInt(10_000 - ctx.slippageBps)) / 10_000n;

    const hops: RouteHop[] = [];
    for (const leg of route.bestRoute ?? []) {
      for (const swap of leg.swaps ?? []) {
        for (const exchange of swap.swapExchanges ?? []) {
          hops.push({
            name: exchange.exchange,
            percent: (exchange.percent * leg.percent) / 100,
            fromSymbol: from.symbol,
            toSymbol: to.symbol,
          });
        }
      }
    }

    const srcUsd = Number(route.srcUSD) || toNumber(sellAmount, from.decimals) * ctx.priceOf(from);
    const destUsd = Number(route.destUSD) || toNumber(netOut, to.decimals) * ctx.priceOf(to);
    const feeAmountUsd = toNumber(feeAmount, to.decimals) * ctx.priceOf(to);

    return {
      aggregator: 'paraswap',
      displayName: this.displayName,
      source: 'live',
      grossOut: grossOut.toString(),
      netOut: netOut.toString(),
      minOut: minOut.toString(),
      netOutUsd: toNumber(netOut, to.decimals) * ctx.priceOf(to),
      fee: {
        bps: effectiveBps,
        chargedOn: 'output',
        amount: feeAmount.toString(),
        assetId: to.id,
        recipient: feePolicy.recipients.evm,
        amountUsd: feeAmountUsd,
        integratorShareBps: 10_000,
        netToOperatorUsd: feeAmountUsd,
      },
      gasUsd: Number(route.gasCostUSD) || 0,
      priceImpactPct: srcUsd > 0 ? Math.max(0, ((srcUsd - destUsd) / srcUsd) * 100) : 0,
      etaSeconds: chain.blockSeconds * chain.confirmations + 15,
      route: hops.sort((a, b) => b.percent - a.percent).slice(0, 6),
      notes: [`Fee capped at ${PARASWAP_MAX_FEE_BPS} bps; direct transfer enabled`],
      latencyMs,
      requestPreview: { method: 'GET', url },
    };
  },
};
