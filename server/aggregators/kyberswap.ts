/**
 * KyberSwap Aggregator API v1 adapter.
 *
 * Two-step flow, exactly as the docs prescribe:
 *   1. GET  /{chain}/api/v1/routes      → routeSummary (must be passed VERBATIM)
 *   2. POST /{chain}/api/v1/route/build → encoded calldata
 *
 * Partner fee parameters (on the GET):
 *   chargeFeeBy = currency_in | currency_out
 *   feeReceiver = wallet address (comma-separated list for multi-recipient)
 *   feeAmount   = bps when isInBps=true, else absolute wei
 *   isInBps     = true
 *
 * Docs: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator
 *       /aggregator-api-specification/evm-swaps
 *
 * No API key needed — but x-client-id must be sent or rate limits tighten.
 */

import { isEvmAsset, type Asset } from '../../shared/assets.js';
import { CHAINS } from '../../shared/chains.js';
import { toNumber } from '../../shared/money.js';
import type { AggregatorQuote, RouteHop } from '../../shared/types.js';
import { AdapterError, fetchJson, type Adapter, type AdapterContext } from './types.js';

const BASE_URL = 'https://aggregator-api.kyberswap.com';

interface KyberRouteSummary {
  tokenIn: string;
  amountIn: string;
  amountInUsd: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasPrice: string;
  gasUsd: string;
  l1FeeUsd?: string;
  extraFee?: {
    feeAmount: string;
    chargeFeeBy: string;
    isInBps: boolean;
    feeReceiver: string;
  };
  route: {
    pool: string;
    tokenIn: string;
    tokenOut: string;
    swapAmount: string;
    amountOut: string;
    exchange: string;
    poolType: string;
  }[][];
  routeID: string;
  checksum: string;
  timestamp: number;
}

interface KyberRoutesResponse {
  code: number;
  message: string;
  data?: { routeSummary: KyberRouteSummary; routerAddress: string };
}

interface KyberBuildResponse {
  code: number;
  message: string;
  data?: {
    amountIn: string;
    amountOut: string;
    gas: string;
    gasUsd: string;
    data: string;
    routerAddress: string;
    transactionValue: string;
  };
}

export const kyberSwapAdapter: Adapter = {
  id: 'kyberswap',
  displayName: 'KyberSwap Aggregator',
  docsUrl:
    'https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification/evm-swaps',
  feeMechanism: 'chargeFeeBy + feeReceiver + feeAmount (bps) on the route request',

  supports(from: Asset, to: Asset) {
    if (!isEvmAsset(from) || !isEvmAsset(to)) {
      return { ok: false as const, reason: 'KyberSwap Aggregator is EVM-only' };
    }
    if (from.chain !== to.chain) {
      return { ok: false as const, reason: 'Single-chain routing only' };
    }
    if (!CHAINS[from.chain].kyberSlug) {
      return { ok: false as const, reason: `${CHAINS[from.chain].name} is not supported` };
    }
    return { ok: true as const };
  },

  async quote(ctx: AdapterContext): Promise<AggregatorQuote> {
    const { from, to, sellAmount, feeBps, feePolicy } = ctx;
    const chain = CHAINS[from.chain];
    const slug = chain.kyberSlug!;

    const params = new URLSearchParams({
      tokenIn: from.address!,
      tokenOut: to.address!,
      amountIn: sellAmount.toString(),
      gasInclude: 'true',
      chargeFeeBy: feePolicy.chargeOn === 'output' ? 'currency_out' : 'currency_in',
      feeReceiver: feePolicy.recipients.evm,
      feeAmount: String(feeBps),
      isInBps: 'true',
    });
    if (ctx.takerAddress) params.set('origin', ctx.takerAddress);

    const routesUrl = `${BASE_URL}/${slug}/api/v1/routes?${params.toString()}`;
    const headers = { 'x-client-id': feePolicy.clientId };

    const { data: routesBody, latencyMs } = await fetchJson<KyberRoutesResponse>(routesUrl, {
      headers,
      signal: ctx.signal,
    });

    if (routesBody.code !== 0 || !routesBody.data) {
      throw new AdapterError(routesBody.message || 'No route found', 'kyberswap');
    }

    const summary = routesBody.data.routeSummary;
    const grossOut = BigInt(summary.amountOut);

    // Kyber reports amountOut already net of the extraFee when charging on
    // currency_out; when charging on currency_in the fee is skimmed from the
    // input before routing.
    const feeChargedOnOutput = feePolicy.chargeOn === 'output';
    const feeAmount = BigInt(summary.extraFee?.feeAmount || '0');
    const netOut = grossOut;
    const minOut = (netOut * BigInt(10_000 - ctx.slippageBps)) / 10_000n;

    const feeAsset = feeChargedOnOutput ? to : from;
    const feeAmountResolved =
      feeAmount > 0n
        ? feeAmount
        : // Older responses leave extraFee blank; recompute from bps.
          ((feeChargedOnOutput ? grossOut : sellAmount) * BigInt(feeBps)) / 10_000n;
    const feeAmountUsd = toNumber(feeAmountResolved, feeAsset.decimals) * ctx.priceOf(feeAsset);

    const route: RouteHop[] = summary.route.map((hopSet) => {
      const primary = hopSet[0];
      const swapTotal = hopSet.reduce((sum, h) => sum + BigInt(h.swapAmount), 0n);
      return {
        name: hopSet.length > 1 ? `${primary.exchange} +${hopSet.length - 1}` : primary.exchange,
        percent: sellAmount > 0n ? Number((swapTotal * 100n) / sellAmount) : 100,
        fromSymbol: primary.tokenIn.toLowerCase() === from.address!.toLowerCase() ? from.symbol : '…',
        toSymbol: primary.tokenOut.toLowerCase() === to.address!.toLowerCase() ? to.symbol : '…',
      };
    });

    const amountInUsd = Number(summary.amountInUsd) || 0;
    const amountOutUsd = Number(summary.amountOutUsd) || 0;
    const priceImpactPct =
      amountInUsd > 0 ? Math.max(0, ((amountInUsd - amountOutUsd) / amountInUsd) * 100) : 0;

    // Fetch calldata only when a wallet is connected — /route/build needs a
    // sender and the routeSummary expires quickly.
    let buildPreview: { method: string; url: string; body?: unknown } | undefined;
    if (ctx.takerAddress) {
      buildPreview = {
        method: 'POST',
        url: `${BASE_URL}/${slug}/api/v1/route/build`,
        body: {
          routeSummary: '<verbatim routeSummary from GET /routes>',
          sender: ctx.takerAddress,
          recipient: ctx.destinationAddress ?? ctx.takerAddress,
          slippageTolerance: ctx.slippageBps,
          source: feePolicy.clientId,
        },
      };
    }

    return {
      aggregator: 'kyberswap',
      displayName: this.displayName,
      source: 'live',
      grossOut: (feeChargedOnOutput ? grossOut + feeAmountResolved : grossOut).toString(),
      netOut: netOut.toString(),
      minOut: minOut.toString(),
      netOutUsd: amountOutUsd || toNumber(netOut, to.decimals) * ctx.priceOf(to),
      fee: {
        bps: feeBps,
        chargedOn: feePolicy.chargeOn,
        amount: feeAmountResolved.toString(),
        assetId: feeAsset.id,
        recipient: feePolicy.recipients.evm,
        amountUsd: feeAmountUsd,
        integratorShareBps: 10_000,
        netToOperatorUsd: feeAmountUsd,
      },
      gasUsd: Number(summary.gasUsd) + Number(summary.l1FeeUsd ?? 0),
      priceImpactPct,
      etaSeconds: chain.blockSeconds * chain.confirmations + 12,
      route,
      notes: [`Route ID ${summary.routeID.slice(0, 8)}… valid for ~20s`],
      latencyMs,
      requestPreview: buildPreview ?? { method: 'GET', url: routesUrl },
    };
  },
};

/** Step 2 of the Kyber flow — called at execution time, not at quote time. */
export async function buildKyberTransaction(opts: {
  chainSlug: string;
  routeSummary: unknown;
  sender: string;
  recipient: string;
  slippageBps: number;
  clientId: string;
  deadline?: number;
  signal?: AbortSignal;
}): Promise<{ to: string; data: string; value: string; gas: string }> {
  const { data } = await fetchJson<KyberBuildResponse>(
    `${BASE_URL}/${opts.chainSlug}/api/v1/route/build`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': opts.clientId },
      body: JSON.stringify({
        routeSummary: opts.routeSummary,
        sender: opts.sender,
        recipient: opts.recipient,
        slippageTolerance: opts.slippageBps,
        deadline: opts.deadline ?? Math.floor(Date.now() / 1000) + 1200,
        source: opts.clientId,
        enableGasEstimation: true,
      }),
      signal: opts.signal,
    },
  );

  if (data.code !== 0 || !data.data) {
    throw new AdapterError(data.message || 'route/build failed', 'kyberswap');
  }
  return {
    to: data.data.routerAddress,
    data: data.data.data,
    value: data.data.transactionValue,
    gas: data.data.gas,
  };
}
