/**
 * Jupiter adapter (Solana).
 *
 * Fee params:
 *   platformFeeBps — on GET /swap/v1/quote
 *   feeAccount     — on POST /swap; any valid token account whose mint is the
 *                    input or output mint of the swap
 *
 * Since January 2025 the Referral Program is no longer required for the swap
 * API — any valid token account works as feeAccount. (It is still required for
 * the Trigger API.)
 *
 * Docs: https://dev.jup.ag/docs/swap-api/add-fees-to-swap
 */

import type { Asset } from '../../shared/assets.js';
import { CHAINS } from '../../shared/chains.js';
import { toNumber } from '../../shared/money.js';
import type { AggregatorQuote, RouteHop } from '../../shared/types.js';
import { AdapterError, fetchJson, type Adapter, type AdapterContext } from './types.js';

const BASE_URL = process.env.JUPITER_API_URL ?? 'https://api.jup.ag/swap/v1';

interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  platformFee?: { amount: string; feeBps: number } | null;
  routePlan: {
    swapInfo: {
      ammKey: string;
      label?: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount?: string;
    };
    percent: number;
  }[];
  contextSlot?: number;
  error?: string;
}

export const jupiterAdapter: Adapter = {
  id: 'jupiter',
  displayName: 'Jupiter Metis (Solana)',
  docsUrl: 'https://dev.jup.ag/docs/swap-api/add-fees-to-swap',
  feeMechanism: 'platformFeeBps on /quote + feeAccount on /swap',

  supports(from: Asset, to: Asset) {
    if (CHAINS[from.chain].kind !== 'solana' || CHAINS[to.chain].kind !== 'solana') {
      return { ok: false as const, reason: 'Jupiter routes Solana assets only' };
    }
    return { ok: true as const };
  },

  async quote(ctx: AdapterContext): Promise<AggregatorQuote> {
    const { from, to, sellAmount, feeBps, feePolicy } = ctx;

    if (!feePolicy.recipients.solana) {
      throw new AdapterError('No Solana fee account configured', 'jupiter');
    }

    const params = new URLSearchParams({
      inputMint: from.address!,
      outputMint: to.address!,
      amount: sellAmount.toString(),
      slippageBps: String(ctx.slippageBps),
      platformFeeBps: String(feeBps),
      restrictIntermediateTokens: 'true',
    });

    const url = `${BASE_URL}/quote?${params.toString()}`;
    const { data, latencyMs } = await fetchJson<JupiterQuoteResponse>(url, {
      signal: ctx.signal,
      headers: process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : undefined,
    });

    if (data.error) throw new AdapterError(data.error, 'jupiter');

    const netOut = BigInt(data.outAmount);
    const minOut = BigInt(data.otherAmountThreshold);
    const feeAmount = BigInt(data.platformFee?.amount ?? '0');
    const feeAmountUsd = toNumber(feeAmount, to.decimals) * ctx.priceOf(to);

    const route: RouteHop[] = data.routePlan.map((leg) => ({
      name: leg.swapInfo.label ?? leg.swapInfo.ammKey.slice(0, 8),
      percent: leg.percent,
      fromSymbol: leg.swapInfo.inputMint === from.address ? from.symbol : '…',
      toSymbol: leg.swapInfo.outputMint === to.address ? to.symbol : '…',
    }));

    return {
      aggregator: 'jupiter',
      displayName: this.displayName,
      source: 'live',
      grossOut: (netOut + feeAmount).toString(),
      netOut: netOut.toString(),
      minOut: minOut.toString(),
      netOutUsd: toNumber(netOut, to.decimals) * ctx.priceOf(to),
      fee: {
        bps: data.platformFee?.feeBps ?? feeBps,
        chargedOn: 'output',
        amount: feeAmount.toString(),
        assetId: to.id,
        recipient: feePolicy.recipients.solana,
        amountUsd: feeAmountUsd,
        integratorShareBps: 10_000,
        netToOperatorUsd: feeAmountUsd,
      },
      gasUsd: 0.0015,
      priceImpactPct: Math.abs(parseFloat(data.priceImpactPct) * 100),
      etaSeconds: 8,
      route,
      notes: ['feeAccount must be an initialised token account for the fee mint'],
      latencyMs,
      requestPreview: { method: 'GET', url },
    };
  },
};
