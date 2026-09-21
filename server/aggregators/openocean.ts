/**
 * OpenOcean v4 adapter.
 *
 * Fee params:
 *   referrer    — EOA that identifies the partner and receives the fee
 *   referrerFee — PERCENT of the in-token, range 0.01–5 ("1.2" = 1.2%)
 *
 * Important economics: OpenOcean keeps 20% of the referrer fee by default
 * (negotiable), so a 0.5% charge nets the operator ~0.4%. We surface that in
 * `integratorShareBps` so the comparison matrix stays honest.
 *
 * Docs: https://apis.openocean.finance/developer/apis/swap-api/api-v4
 * Public rate limit is low (~2 RPS) — worth an API key for production.
 */

import { isEvmAsset, type Asset } from '../../shared/assets.js';
import { CHAINS } from '../../shared/chains.js';
import { formatUnits, toNumber } from '../../shared/money.js';
import type { AggregatorQuote, RouteHop } from '../../shared/types.js';
import { AdapterError, fetchJson, type Adapter, type AdapterContext } from './types.js';

const BASE_URL = 'https://open-api.openocean.finance/v4';

/** OpenOcean's default cut of the referrer fee. */
export const OPENOCEAN_PLATFORM_SHARE_BPS = 2000; // 20%
export const OPENOCEAN_MAX_FEE_PERCENT = 5;

interface OpenOceanQuoteResponse {
  code: number;
  msg?: string;
  data?: {
    inToken: { address: string; decimals: number; symbol: string };
    outToken: { address: string; decimals: number; symbol: string };
    inAmount: string;
    outAmount: string;
    estimatedGas: string | number;
    minOutAmount?: string;
    from?: string;
    to?: string;
    value?: string;
    data?: string;
    gasPrice?: string;
    price_impact?: string;
    dexes?: { dexIndex: number; dexCode: string; swapAmount: string }[];
    path?: { routes?: { parts: number; subRoutes?: { dexes?: { dex: string; percentage: number }[] }[] }[] };
  };
}

export const openOceanAdapter: Adapter = {
  id: 'openocean',
  displayName: 'OpenOcean v4',
  docsUrl: 'https://apis.openocean.finance/developer/apis/swap-api/api-v4',
  feeMechanism: 'referrer + referrerFee (percent of in-token, 0.01–5)',

  supports(from: Asset, to: Asset) {
    const fromSlug = CHAINS[from.chain].openOceanSlug;
    const toSlug = CHAINS[to.chain].openOceanSlug;
    if (!fromSlug || !toSlug) {
      return { ok: false as const, reason: 'Chain not covered by the OpenOcean v4 API' };
    }
    if (from.chain !== to.chain) {
      return { ok: false as const, reason: 'Single-chain routing only' };
    }
    if (!isEvmAsset(from) && CHAINS[from.chain].kind !== 'solana') {
      return { ok: false as const, reason: 'Unsupported chain kind' };
    }
    return { ok: true as const };
  },

  async quote(ctx: AdapterContext): Promise<AggregatorQuote> {
    const { from, to, sellAmount, feeBps, feePolicy } = ctx;
    const chain = CHAINS[from.chain];
    const slug = chain.openOceanSlug!;

    // referrerFee is a percent string, min 0.01.
    const feePercent = Math.min(Math.max(feeBps / 100, 0.01), OPENOCEAN_MAX_FEE_PERCENT);

    const isSolana = chain.kind === 'solana';
    const referrer = isSolana ? feePolicy.recipients.solana : feePolicy.recipients.evm;
    if (!referrer) {
      throw new AdapterError(`No fee recipient configured for ${chain.name}`, 'openocean');
    }

    // v4 accepts *Decimals params to avoid float amounts entirely.
    const params = new URLSearchParams({
      inTokenAddress: from.address!,
      outTokenAddress: to.address!,
      amountDecimals: sellAmount.toString(),
      gasPriceDecimals: isSolana ? '1' : '8000000000',
      slippage: String(ctx.slippageBps / 100),
      referrer,
      referrerFee: String(feePercent),
    });

    const useSwap = Boolean(ctx.takerAddress);
    if (ctx.takerAddress) {
      params.set('account', ctx.takerAddress);
      if (ctx.destinationAddress && ctx.destinationAddress !== ctx.takerAddress) {
        params.set('sender', ctx.takerAddress);
        params.set('account', ctx.destinationAddress);
      }
    }

    const url = `${BASE_URL}/${slug}/${useSwap ? 'swap' : 'quote'}?${params.toString()}`;
    const { data: body, latencyMs } = await fetchJson<OpenOceanQuoteResponse>(url, {
      signal: ctx.signal,
      headers: process.env.OPENOCEAN_API_KEY
        ? { apikey: process.env.OPENOCEAN_API_KEY }
        : undefined,
    });

    if (body.code !== 200 || !body.data) {
      throw new AdapterError(body.msg || `OpenOcean error code ${body.code}`, 'openocean');
    }

    const netOut = BigInt(body.data.outAmount);
    const minOut = body.data.minOutAmount
      ? BigInt(body.data.minOutAmount)
      : (netOut * BigInt(10_000 - ctx.slippageBps)) / 10_000n;

    // The fee is skimmed from the IN token.
    const feeAmount = (sellAmount * BigInt(Math.round(feePercent * 100))) / 10_000n;
    const feeAmountUsd = toNumber(feeAmount, from.decimals) * ctx.priceOf(from);
    const operatorShareBps = 10_000 - OPENOCEAN_PLATFORM_SHARE_BPS;

    const route: RouteHop[] = (body.data.dexes ?? []).slice(0, 6).map((dex) => ({
      name: dex.dexCode,
      percent:
        sellAmount > 0n ? Number((BigInt(dex.swapAmount || '0') * 100n) / sellAmount) : 100,
      fromSymbol: from.symbol,
      toSymbol: to.symbol,
    }));

    const buyUsd = toNumber(netOut, to.decimals) * ctx.priceOf(to);
    const sellUsd = toNumber(sellAmount, from.decimals) * ctx.priceOf(from);

    return {
      aggregator: 'openocean',
      displayName: this.displayName,
      source: 'live',
      grossOut: netOut.toString(),
      netOut: netOut.toString(),
      minOut: minOut.toString(),
      netOutUsd: buyUsd,
      fee: {
        bps: Math.round(feePercent * 100),
        chargedOn: 'input',
        amount: feeAmount.toString(),
        assetId: from.id,
        recipient: referrer,
        amountUsd: feeAmountUsd,
        integratorShareBps: operatorShareBps,
        netToOperatorUsd: (feeAmountUsd * operatorShareBps) / 10_000,
      },
      gasUsd: estimateGasUsd(body.data, ctx),
      priceImpactPct: body.data.price_impact
        ? Math.abs(parseFloat(body.data.price_impact.replace('%', '')))
        : sellUsd > 0
          ? Math.max(0, ((sellUsd - buyUsd) / sellUsd) * 100)
          : 0,
      etaSeconds: chain.blockSeconds * chain.confirmations + 12,
      route,
      notes: [
        `OpenOcean retains ${OPENOCEAN_PLATFORM_SHARE_BPS / 100}% of the referrer fee by default`,
        `Fee taken from input: ${formatUnits(feeAmount, from.decimals)} ${from.symbol}`,
      ],
      latencyMs,
      requestPreview: { method: 'GET', url },
    };
  },
};

function estimateGasUsd(data: NonNullable<OpenOceanQuoteResponse['data']>, ctx: AdapterContext): number {
  const gas = BigInt(Math.round(Number(data.estimatedGas) || 0));
  const gasPrice = BigInt(data.gasPrice ?? '8000000000');
  if (gas === 0n) return 0;
  const chain = CHAINS[ctx.from.chain];
  if (chain.kind === 'solana') return 0.002;
  return toNumber(gas * gasPrice, 18) * 3420;
}
