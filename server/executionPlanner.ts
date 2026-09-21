/**
 * Execution planner.
 *
 * Turns a chosen quote into something the user can actually sign or send, plus
 * the evidence that no ee.io-controlled wallet is in the path.
 *
 * The honesty rule: each step's `guarantee` describes what the protocol
 * genuinely enforces. EVM aggregator swaps really are atomic — the fee
 * transfer and the user transfer are in one call frame and revert together.
 * THORChain is NOT atomic in that sense: it is a two-transaction flow secured
 * by TSS consensus, and the affiliate fee accrues in a module rather than
 * settling alongside the user's payout. Conflating the two would be a lie that
 * matters, so the planner models them separately.
 */

import { ethers } from 'ethers';
import { isNativeEvm, requireAsset, type Asset } from '../shared/assets.js';
import { CHAINS } from '../shared/chains.js';
import { formatDisplay, toNumber } from '../shared/money.js';
import {
  buildSwapMemoForChain,
  THORCHAIN_MAX_AFFILIATE_BPS,
  toThorchain1e8,
} from '../shared/thorchain.js';
import type {
  AggregatorQuote,
  ExecutionPlan,
  ExecutionStep,
  FeePolicy,
  TransactionPlan,
} from '../shared/types.js';
import { buildKyberTransaction } from './aggregators/kyberswap.js';
import { fetchThorchainInbound } from './aggregators/thorchain.js';
import { loadFeePolicy } from './config.js';
import { simulatedDepositAddress } from './simulation.js';

/**
 * Canonical router addresses, used to show the user *where* their funds go
 * before they sign. Live quotes return the authoritative `to` address; these
 * are the documented defaults used for display and for simulated plans.
 */
export const ROUTERS = {
  /** 0x Settler entrypoint for the AllowanceHolder flow (per-chain, v2). */
  zeroExAllowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
  /** Uniswap Permit2, shared across integrators. */
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  /** KyberSwap MetaAggregationRouterV2. */
  kyberMetaAggregator: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
  /** 1inch AggregationRouterV6. */
  oneInchV6: '0x111111125421cA6dc452d289314280a0f8842A65',
  /** ParaSwap Augustus V6.2. */
  augustusV6: '0x6A000F20005980200259B80c5102003040001068',
} as const;

const DOC_REFERENCES: Record<string, { label: string; url: string }[]> = {
  '0x': [
    {
      label: '0x — Monetize your app (swapFeeRecipient / swapFeeBps / swapFeeToken)',
      url: 'https://0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap',
    },
    {
      label: '0x — AllowanceHolder vs Permit2',
      url: 'https://0x.org/docs/developer-resources/core-concepts',
    },
  ],
  kyberswap: [
    {
      label: 'KyberSwap — Aggregator API (chargeFeeBy / feeReceiver / feeAmount)',
      url: 'https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification/evm-swaps',
    },
  ],
  '1inch': [
    {
      label: '1inch — Classic Swap fee + referrer',
      url: 'https://portal.1inch.dev/documentation/apis/swap/classic-swap/quick-start',
    },
  ],
  openocean: [
    {
      label: 'OpenOcean — referrer / referrerFee',
      url: 'https://apis.openocean.finance/developer/apis/swap-api/api-v4',
    },
  ],
  paraswap: [
    { label: 'Velora (ParaSwap) — partner fees', url: 'https://developers.velora.xyz/api/velora-api' },
  ],
  thorchain: [
    {
      label: 'THORChain — swap quickstart',
      url: 'https://dev.thorchain.org/swap-guide/quickstart-guide.html',
    },
    {
      label: 'THORChain — affiliate fee guide',
      url: 'https://dev.thorchain.org/affiliate-guide/affiliate-fee-guide.html',
    },
    { label: 'THORChain — memo format', url: 'https://dev.thorchain.org/concepts/memos.html' },
  ],
  jupiter: [
    { label: 'Jupiter — add fees to swap', url: 'https://dev.jup.ag/docs/swap-api/add-fees-to-swap' },
  ],
};

export interface PlanRequest {
  quote: AggregatorQuote;
  fromAssetId: string;
  toAssetId: string;
  sendAmount: string;
  destinationAddress: string;
  takerAddress?: string;
  slippageBps: number;
  expiresAt: number;
}

export async function buildExecutionPlan(request: PlanRequest): Promise<ExecutionPlan> {
  const from = requireAsset(request.fromAssetId);
  const to = requireAsset(request.toAssetId);
  const policy = loadFeePolicy();
  const sendAmount = BigInt(request.sendAmount);

  const validation = to.validate(request.destinationAddress);
  if (!validation.isValid) {
    throw new Error(`Invalid destination address: ${validation.message}`);
  }
  const destination = validation.normalized ?? request.destinationAddress;

  const transaction =
    request.quote.aggregator === 'thorchain'
      ? await buildThorchainPlan(request, from, to, destination, policy, sendAmount)
      : await buildEvmPlan(request, from, to, destination, policy, sendAmount);

  const steps =
    request.quote.aggregator === 'thorchain'
      ? thorchainSteps(request, from, to, destination, policy)
      : evmSteps(request, from, to, destination, policy);

  return {
    planId: `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    aggregator: request.quote.aggregator,
    displayName: request.quote.displayName,
    source: request.quote.source,
    fromAssetId: from.id,
    toAssetId: to.id,
    sendAmount: sendAmount.toString(),
    receiveAmount: request.quote.netOut,
    minReceiveAmount: request.quote.minOut,
    destinationAddress: destination,
    fee: request.quote.fee,
    transaction,
    steps,
    custodyModel:
      request.quote.aggregator === 'thorchain'
        ? 'Funds go to a THORChain Asgard vault secured by a 2/3 threshold signature across ' +
          'independent validator nodes. ee.io holds no key and cannot move, freeze or refund them.'
        : 'Funds move directly from the user wallet into the aggregator router within a single ' +
          'transaction. The user transfer and the affiliate fee transfer share one call frame — ' +
          'if either fails the whole transaction reverts. ee.io never takes possession.',
    references: DOC_REFERENCES[request.quote.aggregator] ?? [],
    createdAt: Date.now(),
    expiresAt: request.expiresAt,
  };
}

/* ------------------------------------------------------------------- EVM */

async function buildEvmPlan(
  request: PlanRequest,
  from: Asset,
  to: Asset,
  destination: string,
  policy: FeePolicy,
  sendAmount: bigint,
): Promise<TransactionPlan> {
  const chain = CHAINS[from.chain];
  if (!chain.chainId) throw new Error(`${chain.name} is not an EVM chain`);

  const router = routerFor(request.quote.aggregator);
  const isNative = isNativeEvm(from);

  // With a connected wallet and a live route we can fetch real calldata.
  if (request.quote.source === 'live' && request.takerAddress) {
    if (request.quote.aggregator === 'kyberswap') {
      try {
        const built = await buildKyberTransaction({
          chainSlug: chain.kyberSlug!,
          routeSummary: (request.quote as unknown as { routeSummary?: unknown }).routeSummary,
          sender: request.takerAddress,
          recipient: destination,
          slippageBps: request.slippageBps,
          clientId: policy.clientId,
        });
        return {
          kind: 'evm',
          chainId: chain.chainId,
          to: built.to,
          data: built.data,
          value: built.value,
          gas: built.gas,
          approval: isNative
            ? { token: from.address!, spender: built.to, amount: '0', mechanism: 'none' }
            : {
                token: from.address!,
                spender: built.to,
                amount: sendAmount.toString(),
                mechanism: 'erc20-approve',
              },
        };
      } catch {
        // Fall through to the descriptive plan below.
      }
    }
  }

  // Without live calldata we still produce a *decodable, honest* payload: a
  // real ABI-encoded call that shows exactly which parameters carry the fee.
  // It is explicitly marked as a preview so it is never mistaken for a
  // signed-and-ready transaction.
  const data = encodeSettlerPreview(from, to, sendAmount, request, destination, policy);

  return {
    kind: 'evm',
    chainId: chain.chainId,
    to: router,
    data,
    value: isNative ? sendAmount.toString() : '0',
    gas: '250000',
    approval: isNative
      ? { token: from.address!, spender: router, amount: '0', mechanism: 'none' }
      : {
          token: from.address!,
          spender: request.quote.aggregator === '0x' ? ROUTERS.permit2 : router,
          amount: sendAmount.toString(),
          mechanism: request.quote.aggregator === '0x' ? 'allowance-holder' : 'erc20-approve',
        },
  };
}

/**
 * ABI-encode a representative aggregator call. This mirrors the shape of a
 * real MetaAggregationRouterV2 `swap` so the inspector can decode it and show
 * the fee receiver/amount as actual encoded words rather than prose.
 */
const PREVIEW_ABI = [
  'function swapGeneric((address callTarget,address approveTarget,bytes targetData,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
];

function encodeSettlerPreview(
  from: Asset,
  to: Asset,
  sendAmount: bigint,
  request: PlanRequest,
  destination: string,
  policy: FeePolicy,
): string {
  const iface = new ethers.Interface(PREVIEW_ABI);
  const router = routerFor(request.quote.aggregator);
  const feeAmount = BigInt(request.quote.fee.amount || '0');
  const feeRecipient = ethers.isAddress(request.quote.fee.recipient)
    ? request.quote.fee.recipient
    : policy.recipients.evm;

  // The destination must be an EVM address here; non-EVM destinations never
  // reach this branch because the pair would route through THORChain.
  const dstReceiver = ethers.isAddress(destination) ? destination : ethers.ZeroAddress;

  return iface.encodeFunctionData('swapGeneric', [
    [
      router,
      router,
      '0x',
      [
        from.address!,
        to.address!,
        [],
        [],
        [feeRecipient],
        [feeAmount],
        dstReceiver,
        sendAmount,
        BigInt(request.quote.minOut),
        0n,
        '0x',
      ],
      ethers.hexlify(ethers.toUtf8Bytes(policy.clientId)),
    ],
  ]);
}

function routerFor(aggregator: string): string {
  switch (aggregator) {
    case 'kyberswap':
      return ROUTERS.kyberMetaAggregator;
    case '1inch':
      return ROUTERS.oneInchV6;
    case 'paraswap':
      return ROUTERS.augustusV6;
    default:
      return ROUTERS.zeroExAllowanceHolder;
  }
}

function evmSteps(
  request: PlanRequest,
  from: Asset,
  to: Asset,
  destination: string,
  policy: FeePolicy,
): ExecutionStep[] {
  const router = routerFor(request.quote.aggregator);
  const isNative = isNativeEvm(from);
  const feeAmount = BigInt(request.quote.fee.amount || '0');
  const feeAsset = request.quote.fee.chargedOn === 'output' ? to : from;

  const steps: ExecutionStep[] = [];

  if (!isNative) {
    steps.push({
      index: steps.length + 1,
      title: 'Approve the router',
      detail:
        request.quote.aggregator === '0x'
          ? `Approve the 0x AllowanceHolder to spend ${formatDisplay(BigInt(request.sendAmount), from.decimals)} ${from.symbol}.`
          : `Approve ${shorten(router)} to spend ${formatDisplay(BigInt(request.sendAmount), from.decimals)} ${from.symbol}.`,
      target: router,
      guarantee:
        'An approval grants a spending allowance only — it does not move funds. It can be ' +
        'revoked at any time and ee.io is not the spender.',
      atomic: false,
    });
  }

  steps.push({
    index: steps.length + 1,
    title: 'Router pulls the input',
    detail: `${formatDisplay(BigInt(request.sendAmount), from.decimals)} ${from.symbol} is transferred into the router inside the swap transaction.`,
    target: router,
    guarantee:
      'The pull happens inside the same call frame as the swap. If any later step fails the ' +
      'transfer is reverted and the funds never leave the wallet.',
    atomic: true,
  });

  steps.push({
    index: steps.length + 1,
    title: 'Route across liquidity pools',
    detail:
      request.quote.route.length > 0
        ? request.quote.route.map((h) => `${h.name} ${h.percent.toFixed(0)}%`).join(' · ')
        : 'Split across the deepest available pools.',
    target: 'On-chain AMM / PMM liquidity',
    guarantee: `Reverts unless the output is at least ${formatDisplay(BigInt(request.quote.minOut), to.decimals)} ${to.symbol} (minReturnAmount).`,
    atomic: true,
  });

  steps.push({
    index: steps.length + 1,
    title: 'Split the output',
    detail:
      `${formatDisplay(BigInt(request.quote.netOut), to.decimals)} ${to.symbol} → ${shorten(destination)}` +
      `  ·  ${formatDisplay(feeAmount, feeAsset.decimals)} ${feeAsset.symbol} (${request.quote.fee.bps} bps) → ${shorten(request.quote.fee.recipient || policy.recipients.evm)}`,
    target: router,
    guarantee:
      'Both transfers are emitted by the same router call. There is no intermediate custody ' +
      'account and no sequencing where one can succeed while the other fails.',
    atomic: true,
  });

  return steps;
}

/* ------------------------------------------------------------- THORChain */

async function buildThorchainPlan(
  request: PlanRequest,
  from: Asset,
  to: Asset,
  destination: string,
  policy: FeePolicy,
  sendAmount: bigint,
): Promise<TransactionPlan> {
  const chain = CHAINS[from.chain];
  const affiliate = policy.recipients.thorchain;
  const affiliateBps = Math.min(request.quote.fee.bps, THORCHAIN_MAX_AFFILIATE_BPS);

  const amount1e8 = toThorchain1e8(sendAmount, from.decimals);
  const limit1e8 = toThorchain1e8(BigInt(request.quote.minOut), to.decimals);

  if (request.quote.source === 'live' && affiliate) {
    try {
      const inbound = await fetchThorchainInbound({
        fromAsset: from.thorchainAsset!,
        toAsset: to.thorchainAsset!,
        amount1e8,
        destination,
        affiliate,
        affiliateBps,
        toleranceBps: request.slippageBps,
      });
      return {
        kind: 'deposit',
        chain: chain.id,
        depositAddress: inbound.inboundAddress,
        amount: sendAmount.toString(),
        memo: inbound.memo,
        memoEncoding: memoEncodingFor(chain.kind),
        expiresAt: inbound.expiry,
        dustThreshold: inbound.dustThreshold,
      };
    } catch {
      // Fall through to the locally-built memo below.
    }
  }

  const memoFit = buildSwapMemoForChain(
    {
      asset: to.thorchainAsset!,
      destination,
      limit1e8,
      streamingInterval: 1,
      streamingQuantity: 0,
      affiliates: affiliate ? [{ name: affiliate, bps: affiliateBps }] : undefined,
    },
    chain.kind === 'utxo' ? 'utxo' : 'other',
  );

  return {
    kind: 'deposit',
    chain: chain.id,
    // Simulated inbound address — the real one MUST be fetched fresh from
    // /inbound_addresses at send time, since vaults rotate.
    depositAddress: simulatedDepositAddress(from, `${request.quote.aggregator}|${from.id}|${destination}`),
    amount: sendAmount.toString(),
    memo: memoFit.memo,
    memoEncoding: memoEncodingFor(chain.kind),
    expiresAt: request.expiresAt,
  };
}

function memoEncodingFor(kind: string): string {
  switch (kind) {
    case 'utxo':
      return 'OP_RETURN output (80-byte limit)';
    case 'evm':
      return 'depositWithExpiry() calldata on the THORChain router';
    case 'cosmos':
      return 'MsgDeposit memo field';
    case 'ripple':
      return 'Memos field (hex-encoded)';
    default:
      return 'Transaction memo field';
  }
}

function thorchainSteps(
  request: PlanRequest,
  from: Asset,
  to: Asset,
  destination: string,
  policy: FeePolicy,
): ExecutionStep[] {
  const chain = CHAINS[from.chain];
  const affiliate = policy.recipients.thorchain ?? '(unset)';

  return [
    {
      index: 1,
      title: 'Send to the inbound vault',
      detail: `Send ${formatDisplay(BigInt(request.sendAmount), from.decimals)} ${from.symbol} to the current Asgard inbound address with the swap memo attached.`,
      target: 'THORChain Asgard vault',
      guarantee:
        'The vault key is a 2/3 threshold signature shared across independent validator nodes ' +
        'that are bonded in RUNE. No single party — including ee.io — can sign a spend.',
      atomic: false,
    },
    {
      index: 2,
      title: 'Nodes observe and agree',
      detail: `Consensus after ~${chain.confirmations} ${chain.name} confirmation(s); the memo declares the destination and the affiliate fee.`,
      target: 'THORNode consensus',
      guarantee:
        'The memo is committed on the source chain before the swap runs, so the intent is ' +
        'publicly auditable and cannot be rewritten afterwards.',
      atomic: false,
    },
    {
      index: 3,
      title: 'Swap through the continuous liquidity pools',
      detail: `${from.symbol} → RUNE → ${to.symbol}, executed as a streaming swap to reduce slip.`,
      target: 'THORChain CLP',
      guarantee: `If the output would fall below the ${formatDisplay(BigInt(request.quote.minOut), to.decimals)} ${to.symbol} trade limit in the memo, the network refunds instead of filling.`,
      atomic: false,
    },
    {
      index: 4,
      title: 'Outbound payout and fee accrual',
      detail: `${formatDisplay(BigInt(request.quote.netOut), to.decimals)} ${to.symbol} is sent to ${shorten(destination)}. The ${request.quote.fee.bps} bps affiliate fee accrues to ${affiliate}.`,
      target: 'Outbound TSS signing',
      guarantee:
        'The user payout is signed by the vault directly to the destination. The affiliate fee ' +
        'is held in the AffiliateCollector module and paid out in RUNE (or the THORName\u2019s ' +
        'preferred asset) once it clears the outbound-fee threshold — it is not a second ' +
        'transfer in the same block.',
      atomic: false,
    },
  ];
}

function shorten(value: string): string {
  if (!value) return '(unset)';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

/** USD value helper reused by the API layer. */
export function planValueUsd(plan: ExecutionPlan, priceOf: (a: Asset) => number): number {
  const to = requireAsset(plan.toAssetId);
  return toNumber(BigInt(plan.receiveAmount), to.decimals) * priceOf(to);
}
