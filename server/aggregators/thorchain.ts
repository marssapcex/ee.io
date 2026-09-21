/**
 * THORChain adapter — the only route here that settles genuinely cross-chain
 * native assets (BTC → ETH with no wrapped token anywhere in the path).
 *
 * Flow: GET /thorchain/quote/swap returns `inbound_address`, `memo`, fees and
 * `expected_amount_out`. The user sends the input asset to inbound_address
 * with that memo attached; THORChain's TSS vaults do the rest.
 *
 * Affiliate fee: `affiliate` (THORName or thor1 address) + `affiliate_bps`,
 * capped at 1000 bps total. THORChain deducts it and accrues it in the
 * AffiliateCollector module, paying out in RUNE (or the THORName's preferred
 * asset) once it clears the outbound-fee threshold.
 *
 * Docs: https://dev.thorchain.org/swap-guide/quickstart-guide.html
 *       https://dev.thorchain.org/affiliate-guide/affiliate-fee-guide.html
 *
 * Note the 1 request/second/IP rate limit on /quote endpoints.
 */

import { isThorchainRoutable, type Asset } from '../../shared/assets.js';
import { CHAINS } from '../../shared/chains.js';
import { toNumber } from '../../shared/money.js';
import {
  buildSwapMemoForChain,
  fromThorchain1e8,
  THORCHAIN_MAX_AFFILIATE_BPS,
  toThorchain1e8,
} from '../../shared/thorchain.js';
import type { AggregatorQuote } from '../../shared/types.js';
import { AdapterError, fetchJson, type Adapter, type AdapterContext } from './types.js';

const DEFAULT_NODE = process.env.THORNODE_URL ?? 'https://thornode.ninerealms.com';

interface ThorchainQuoteResponse {
  inbound_address?: string;
  inbound_confirmation_blocks?: number;
  inbound_confirmation_seconds?: number;
  outbound_delay_blocks?: number;
  outbound_delay_seconds?: number;
  fees: {
    asset: string;
    affiliate: string;
    outbound: string;
    liquidity: string;
    total: string;
    slippage_bps: number;
    total_bps: number;
  };
  expiry: number;
  warning?: string;
  notes?: string;
  dust_threshold?: string;
  recommended_min_amount_in?: string;
  recommended_gas_rate?: string;
  gas_rate_units?: string;
  memo?: string;
  expected_amount_out: string;
  expected_amount_out_streaming?: string;
  max_streaming_quantity?: number;
  streaming_swap_blocks?: number;
  streaming_swap_seconds?: number;
  total_swap_seconds?: number;
  error?: string;
}

export const thorchainAdapter: Adapter = {
  id: 'thorchain',
  displayName: 'THORChain',
  docsUrl: 'https://dev.thorchain.org/swap-guide/quickstart-guide.html',
  feeMechanism: 'affiliate + affiliate_bps in the swap memo (max 1000 bps)',

  supports(from: Asset, to: Asset) {
    if (!isThorchainRoutable(from)) {
      return { ok: false as const, reason: `${from.symbol} has no THORChain pool` };
    }
    if (!isThorchainRoutable(to)) {
      return { ok: false as const, reason: `${to.symbol} has no THORChain pool` };
    }
    if (from.id === to.id) return { ok: false as const, reason: 'Same asset' };
    return { ok: true as const };
  },

  async quote(ctx: AdapterContext): Promise<AggregatorQuote> {
    const { from, to, sellAmount, feeBps, feePolicy } = ctx;

    const affiliate = feePolicy.recipients.thorchain;
    if (!affiliate) {
      throw new AdapterError('No THORChain affiliate (THORName or thor1 address)', 'thorchain');
    }
    const affiliateBps = Math.min(feeBps, THORCHAIN_MAX_AFFILIATE_BPS);

    // THORChain speaks 1e8 for every asset regardless of native decimals.
    const amount1e8 = toThorchain1e8(sellAmount, from.decimals);
    if (amount1e8 <= 0n) {
      throw new AdapterError('Amount rounds to zero at 1e8 precision', 'thorchain');
    }

    const params = new URLSearchParams({
      from_asset: from.thorchainAsset!,
      to_asset: to.thorchainAsset!,
      amount: amount1e8.toString(),
      affiliate,
      affiliate_bps: String(affiliateBps),
      // Cap the slip users can silently eat; the network refunds beyond this.
      liquidity_tolerance_bps: String(Math.max(ctx.slippageBps, 100)),
    });
    if (ctx.destinationAddress) params.set('destination', ctx.destinationAddress);

    const url = `${DEFAULT_NODE}/thorchain/quote/swap?${params.toString()}`;
    const { data, latencyMs } = await fetchJson<ThorchainQuoteResponse>(url, {
      signal: ctx.signal,
      timeoutMs: 8000,
    });

    if (data.error) throw new AdapterError(data.error, 'thorchain');
    if (!data.expected_amount_out) {
      throw new AdapterError('THORChain returned no output estimate', 'thorchain');
    }

    const expectedOut1e8 = BigInt(data.expected_amount_out_streaming ?? data.expected_amount_out);
    const netOut = fromThorchain1e8(expectedOut1e8, to.decimals);

    // The affiliate fee is reported in the quote's fee asset, at 1e8.
    const affiliateFee1e8 = BigInt(data.fees.affiliate || '0');
    const feeAmount = fromThorchain1e8(affiliateFee1e8, to.decimals);
    const feeAmountUsd = toNumber(feeAmount, to.decimals) * ctx.priceOf(to);

    const outboundFee1e8 = BigInt(data.fees.outbound || '0');
    const gasUsd = toNumber(fromThorchain1e8(outboundFee1e8, to.decimals), to.decimals) * ctx.priceOf(to);

    // Trade limit: floor the output so an adverse move refunds instead of
    // filling at a bad price.
    const limit1e8 = (expectedOut1e8 * BigInt(10_000 - ctx.slippageBps)) / 10_000n;
    const minOut = fromThorchain1e8(limit1e8, to.decimals);

    const sourceChain = CHAINS[from.chain];
    const memoFit = buildSwapMemoForChain(
      {
        asset: to.thorchainAsset!,
        destination: ctx.destinationAddress ?? '<destination>',
        limit1e8,
        streamingInterval: 1,
        streamingQuantity: 0,
        affiliates: [{ name: affiliate, bps: affiliateBps }],
      },
      sourceChain.kind === 'utxo' ? 'utxo' : 'other',
    );

    const notes: string[] = [];
    if (data.streaming_swap_seconds) {
      notes.push(
        `Streaming swap over ${data.streaming_swap_blocks} blocks (~${data.streaming_swap_seconds}s) ` +
          `to cut slip from ${data.fees.slippage_bps} to ${data.fees.slippage_bps} bps`,
      );
    }
    if (data.recommended_min_amount_in) {
      const recommended = fromThorchain1e8(BigInt(data.recommended_min_amount_in), from.decimals);
      if (sellAmount < recommended) {
        notes.push(`Below recommended minimum of ${toNumber(recommended, from.decimals)} ${from.symbol}`);
      }
    }
    if (memoFit.warning) notes.push(memoFit.warning);
    notes.push('Affiliate fee accrues in RUNE via the AffiliateCollector module');

    const buyUsd = toNumber(netOut, to.decimals) * ctx.priceOf(to);

    return {
      aggregator: 'thorchain',
      displayName: this.displayName,
      source: 'live',
      grossOut: (netOut + feeAmount).toString(),
      netOut: netOut.toString(),
      minOut: minOut.toString(),
      netOutUsd: buyUsd,
      fee: {
        bps: affiliateBps,
        chargedOn: 'output',
        amount: feeAmount.toString(),
        assetId: to.id,
        recipient: affiliate,
        amountUsd: feeAmountUsd,
        integratorShareBps: 10_000,
        netToOperatorUsd: feeAmountUsd,
      },
      gasUsd,
      priceImpactPct: data.fees.slippage_bps / 100,
      etaSeconds:
        data.total_swap_seconds ??
        (data.inbound_confirmation_seconds ?? 0) + (data.outbound_delay_seconds ?? 0),
      route: [
        { name: 'Inbound vault', percent: 100, fromSymbol: from.symbol, toSymbol: 'RUNE' },
        { name: 'CLP swap', percent: 100, fromSymbol: 'RUNE', toSymbol: to.symbol },
      ],
      notes,
      latencyMs,
      requestPreview: { method: 'GET', url },
    };
  },
};

/** Fetch the live inbound address + memo at execution time. */
export async function fetchThorchainInbound(opts: {
  fromAsset: string;
  toAsset: string;
  amount1e8: bigint;
  destination: string;
  affiliate: string;
  affiliateBps: number;
  toleranceBps: number;
  signal?: AbortSignal;
}): Promise<{
  inboundAddress: string;
  memo: string;
  expiry: number;
  dustThreshold?: string;
  expectedOut1e8: bigint;
}> {
  const params = new URLSearchParams({
    from_asset: opts.fromAsset,
    to_asset: opts.toAsset,
    amount: opts.amount1e8.toString(),
    destination: opts.destination,
    affiliate: opts.affiliate,
    affiliate_bps: String(opts.affiliateBps),
    liquidity_tolerance_bps: String(opts.toleranceBps),
  });

  const { data } = await fetchJson<ThorchainQuoteResponse>(
    `${DEFAULT_NODE}/thorchain/quote/swap?${params.toString()}`,
    { signal: opts.signal, timeoutMs: 8000 },
  );

  if (!data.inbound_address || !data.memo) {
    throw new AdapterError(data.error ?? 'THORChain did not return an inbound address', 'thorchain');
  }
  return {
    inboundAddress: data.inbound_address,
    memo: data.memo,
    expiry: data.expiry * 1000,
    dustThreshold: data.dust_threshold,
    expectedOut1e8: BigInt(data.expected_amount_out),
  };
}
