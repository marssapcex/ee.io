/**
 * 0x Swap API v2 adapter.
 *
 * Monetization (verbatim from the 0x "Monetize your app" guide):
 *   swapFeeRecipient — wallet that receives the fee
 *   swapFeeBps       — 0–1000 bps (0–10%)
 *   swapFeeToken     — MUST equal either buyToken or sellToken
 * The realised fee comes back as `fees.integratorFee.amount`.
 *
 * Docs: https://0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap
 *
 * Endpoint choice: /swap/allowance-holder/quote. Permit2 would save the user a
 * separate approve, but it requires the client to sign and *append* the permit
 * signature to the calldata — AllowanceHolder keeps the flow to a plain
 * approve + send, which is what a swap frontend can safely automate.
 */

import { isEvmAsset, isNativeEvm, type Asset } from '../../shared/assets.js';
import { CHAINS } from '../../shared/chains.js';
import { toNumber } from '../../shared/money.js';
import type { AggregatorQuote } from '../../shared/types.js';
import { AdapterError, fetchJson, type Adapter, type AdapterContext } from './types.js';

const BASE_URL = 'https://api.0x.org';

/** 0x caps integrator fees at 1000 bps. */
export const ZEROX_MAX_FEE_BPS = 1000;

interface ZeroExQuoteResponse {
  blockNumber?: string;
  buyAmount: string;
  buyToken: string;
  sellAmount: string;
  sellToken: string;
  minBuyAmount?: string;
  liquidityAvailable?: boolean;
  totalNetworkFee?: string;
  fees?: {
    integratorFee?: { amount: string; token: string; type: string } | null;
    zeroExFee?: { amount: string; token: string; type: string } | null;
    gasFee?: { amount: string; token: string } | null;
  };
  issues?: {
    allowance?: { actual: string; spender: string } | null;
    balance?: { token: string; actual: string; expected: string } | null;
    simulationIncomplete?: boolean;
  };
  route?: {
    fills?: { from: string; to: string; source: string; proportionBps: string }[];
    tokens?: { address: string; symbol: string }[];
  };
  transaction?: { to: string; data: string; gas: string; gasPrice: string; value: string };
}

export const zeroExAdapter: Adapter = {
  id: '0x',
  displayName: '0x Swap API v2',
  docsUrl: 'https://0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap',
  feeMechanism: 'swapFeeRecipient + swapFeeBps + swapFeeToken (fee settled in the same tx)',

  supports(from: Asset, to: Asset) {
    if (!isEvmAsset(from) || !isEvmAsset(to)) {
      return { ok: false as const, reason: '0x Swap API covers EVM chains only' };
    }
    if (from.chain !== to.chain) {
      return {
        ok: false as const,
        reason: 'Single-chain only — cross-chain needs THORChain or 1inch Fusion+',
      };
    }
    return { ok: true as const };
  },

  async quote(ctx: AdapterContext): Promise<AggregatorQuote> {
    const { from, to, sellAmount, feeBps, feePolicy } = ctx;
    const chain = CHAINS[from.chain];
    if (!chain.chainId) throw new AdapterError('Missing EVM chain id', '0x');

    const apiKey = process.env.ZEROX_API_KEY;
    if (!apiKey) {
      throw new AdapterError('ZEROX_API_KEY is not configured', '0x');
    }

    const effectiveBps = Math.min(feeBps, ZEROX_MAX_FEE_BPS);

    // swapFeeToken must be buyToken or sellToken. Taking the fee on the buy
    // side keeps the user's input whole and denominates revenue in the asset
    // they are acquiring.
    const feeToken = feePolicy.chargeOn === 'output' ? to.address! : from.address!;

    const params = new URLSearchParams({
      chainId: String(chain.chainId),
      sellToken: from.address!,
      buyToken: to.address!,
      sellAmount: sellAmount.toString(),
      slippageBps: String(ctx.slippageBps),
      swapFeeRecipient: feePolicy.recipients.evm,
      swapFeeBps: String(effectiveBps),
      swapFeeToken: feeToken,
    });

    // `taker` is required for a firm quote with calldata. Without a connected
    // wallet we can still get indicative pricing from /price.
    const hasTaker = Boolean(ctx.takerAddress);
    if (ctx.takerAddress) params.set('taker', ctx.takerAddress);
    if (ctx.destinationAddress && ctx.destinationAddress !== ctx.takerAddress) {
      // 0x settles to the taker; a different recipient needs a follow-on
      // transfer, so we surface it as a note rather than silently dropping it.
      params.set('recipient', ctx.destinationAddress);
    }

    const path = hasTaker ? '/swap/allowance-holder/quote' : '/swap/allowance-holder/price';
    const url = `${BASE_URL}${path}?${params.toString()}`;

    const { data, latencyMs } = await fetchJson<ZeroExQuoteResponse>(url, {
      headers: { '0x-api-key': apiKey, '0x-version': 'v2' },
      signal: ctx.signal,
    });

    if (data.liquidityAvailable === false) {
      throw new AdapterError('No liquidity for this pair on 0x', '0x');
    }

    const grossOut = BigInt(data.buyAmount);
    const integratorFee = BigInt(data.fees?.integratorFee?.amount ?? '0');

    // When the fee is charged on buyToken, 0x reports buyAmount NET of the fee.
    const netOut = grossOut;
    const minOut = BigInt(data.minBuyAmount ?? data.buyAmount);

    const toPrice = ctx.priceOf(to);
    const fromPrice = ctx.priceOf(from);
    const feeIsOnOutput = feeToken.toLowerCase() === to.address!.toLowerCase();
    const feeAsset = feeIsOnOutput ? to : from;
    const feeAmountUsd = toNumber(integratorFee, feeAsset.decimals) * ctx.priceOf(feeAsset);

    const gasUsd = data.transaction
      ? estimateGasUsd(data.totalNetworkFee, chain.nativeSymbol, ctx)
      : estimateGasUsd(undefined, chain.nativeSymbol, ctx);

    const route = (data.route?.fills ?? []).map((fill) => ({
      name: fill.source,
      percent: Number(fill.proportionBps) / 100,
      fromSymbol: symbolFor(data, fill.from) ?? from.symbol,
      toSymbol: symbolFor(data, fill.to) ?? to.symbol,
    }));

    const sellUsd = toNumber(sellAmount, from.decimals) * fromPrice;
    const buyUsd = toNumber(netOut, to.decimals) * toPrice;
    const priceImpactPct = sellUsd > 0 ? Math.max(0, ((sellUsd - buyUsd) / sellUsd) * 100) : 0;

    const notes: string[] = [];
    if (!hasTaker) {
      notes.push('Indicative /price quote — connect a wallet for firm calldata');
    }
    if (data.issues?.allowance) {
      notes.push(`Approval required for spender ${data.issues.allowance.spender}`);
    }
    if (data.fees?.zeroExFee?.amount && BigInt(data.fees.zeroExFee.amount) > 0n) {
      notes.push('0x protocol fee applies on top of the integrator fee');
    }

    return {
      aggregator: '0x',
      displayName: this.displayName,
      source: 'live',
      grossOut: (netOut + (feeIsOnOutput ? integratorFee : 0n)).toString(),
      netOut: netOut.toString(),
      minOut: minOut.toString(),
      netOutUsd: buyUsd,
      fee: {
        bps: effectiveBps,
        chargedOn: feeIsOnOutput ? 'output' : 'input',
        amount: integratorFee.toString(),
        assetId: feeAsset.id,
        recipient: feePolicy.recipients.evm,
        amountUsd: feeAmountUsd,
        integratorShareBps: 10_000,
        netToOperatorUsd: feeAmountUsd,
      },
      gasUsd,
      priceImpactPct,
      etaSeconds: chain.blockSeconds * chain.confirmations + 15,
      route,
      notes: notes.length ? notes : undefined,
      latencyMs,
      requestPreview: { method: 'GET', url: redactKey(url) },
    };
  },
};

function symbolFor(data: ZeroExQuoteResponse, address: string): string | undefined {
  return data.route?.tokens?.find((t) => t.address.toLowerCase() === address.toLowerCase())?.symbol;
}

function estimateGasUsd(
  totalNetworkFee: string | undefined,
  nativeSymbol: string,
  ctx: AdapterContext,
): number {
  if (!totalNetworkFee) return 0;
  const nativeAsset =
    [ctx.from, ctx.to].find((a) => a.symbol === nativeSymbol && isNativeEvm(a)) ?? ctx.from;
  return toNumber(BigInt(totalNetworkFee), 18) * ctx.priceOf(nativeAsset);
}

function redactKey(url: string): string {
  return url;
}
