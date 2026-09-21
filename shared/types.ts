/**
 * Wire types shared by the quote server and the browser client.
 *
 * bigint does not survive JSON, so every base-unit amount crosses the wire as
 * a decimal *string* and is re-parsed with BigInt() on the other side.
 */

export type RateType = 'float' | 'fixed';

export type AggregatorId =
  | '0x'
  | 'kyberswap'
  | '1inch'
  | 'openocean'
  | 'paraswap'
  | 'thorchain'
  | 'jupiter';

export type QuoteSource = 'live' | 'simulated';

export interface FeeQuote {
  /** Affiliate/partner fee in basis points. */
  bps: number;
  /** Which side of the trade the fee is skimmed from. */
  chargedOn: 'input' | 'output';
  /** Base units of the fee, as a decimal string. */
  amount: string;
  /** Asset id the fee is denominated in. */
  assetId: string;
  /** Where the fee lands. */
  recipient: string;
  amountUsd: number;
  /**
   * Some venues take a cut of the integrator fee (OpenOcean keeps 20% by
   * default; 1inch Fusion splits via `share`). This is what actually arrives.
   */
  integratorShareBps?: number;
  netToOperatorUsd?: number;
}

export interface RouteHop {
  /** Human label, e.g. "Uniswap V3". */
  name: string;
  /** Portion of the trade through this hop, 0–100. */
  percent: number;
  fromSymbol: string;
  toSymbol: string;
}

export interface AggregatorQuote {
  aggregator: AggregatorId;
  displayName: string;
  source: QuoteSource;
  /** Base units of the output, before the affiliate fee is applied. */
  grossOut: string;
  /** Base units the user actually receives after fee + slippage floor. */
  netOut: string;
  /** Worst-case output honoured by the tx (minReturn / otherAmountThreshold). */
  minOut: string;
  netOutUsd: number;
  fee: FeeQuote;
  /** Estimated gas/network cost in USD. */
  gasUsd: number;
  /** Price impact as a percentage, e.g. 0.28 for 0.28%. */
  priceImpactPct: number;
  /** Total seconds until the user has funds, including inbound confirmations. */
  etaSeconds: number;
  route: RouteHop[];
  /** Why this provider cannot serve the pair, when unavailable. */
  unavailableReason?: string;
  /** Free-form notes surfaced in the UI (e.g. streaming swap details). */
  notes?: string[];
  /** Milliseconds the upstream call took. */
  latencyMs?: number;
  /** Set on the winning quote. */
  isBest?: boolean;
  /** USD advantage over the runner-up (winner only). */
  advantageUsd?: number;
  /** The exact upstream request, shown in the inspector for verifiability. */
  requestPreview?: { method: string; url: string; body?: unknown };
}

export interface QuoteRequest {
  fromAssetId: string;
  toAssetId: string;
  /** Base units of the side named by `side`. */
  amount: string;
  side: 'send' | 'receive';
  rateType: RateType;
  destinationAddress?: string;
  /** Connected wallet, when the user intends to sign directly. */
  takerAddress?: string;
  slippageBps?: number;
}

export interface QuoteResponse {
  requestId: string;
  fromAssetId: string;
  toAssetId: string;
  /** Echoes the resolved send amount in base units. */
  sendAmount: string;
  /** Best net receive amount in base units. */
  receiveAmount: string;
  rateType: RateType;
  /** 1 unit of `from` expressed in `to`, as a display float. */
  unitRate: number;
  sendUsd: number;
  receiveUsd: number;
  quotes: AggregatorQuote[];
  best?: AggregatorQuote;
  /** Fixed-rate quotes are only honoured until this epoch ms. */
  expiresAt: number;
  /** Server-side validation problems that block execution. */
  warnings: string[];
  /** True when at least one quote came from a live upstream API. */
  anyLive: boolean;
  priceMode: 'live' | 'reference';
}

export interface FeePolicy {
  floatBps: number;
  fixedBps: number;
  /** Per-chain recipient addresses. */
  recipients: {
    evm: string;
    solana?: string;
    thorchain?: string;
  };
  /** Identifier sent to providers that support attribution headers. */
  clientId: string;
  /** Fee side preference for providers that allow choosing. */
  chargeOn: 'input' | 'output';
}

export interface ExecutionStep {
  index: number;
  title: string;
  detail: string;
  /** Contract/module that performs this step. */
  target: string;
  /** The guarantee that makes this step non-custodial. */
  guarantee: string;
  atomic: boolean;
}

export interface EvmTransactionPlan {
  kind: 'evm';
  chainId: number;
  to: string;
  data: string;
  value: string;
  gas?: string;
  /** Token approval the user must grant before `to` can pull funds. */
  approval?: {
    token: string;
    spender: string;
    amount: string;
    /** Permit2 uses a signature rather than an on-chain approve. */
    mechanism: 'erc20-approve' | 'permit2' | 'allowance-holder' | 'none';
  };
}

export interface DepositTransactionPlan {
  kind: 'deposit';
  /** Chain the user sends from. */
  chain: string;
  /** Vault/inbound address supplied by the protocol (never ee.io-controlled). */
  depositAddress: string;
  amount: string;
  memo?: string;
  /** How the memo must be attached (OP_RETURN, tx memo field, calldata…). */
  memoEncoding?: string;
  expiresAt: number;
  dustThreshold?: string;
}

export type TransactionPlan = EvmTransactionPlan | DepositTransactionPlan;

export interface ExecutionPlan {
  planId: string;
  aggregator: AggregatorId;
  displayName: string;
  source: QuoteSource;
  fromAssetId: string;
  toAssetId: string;
  sendAmount: string;
  receiveAmount: string;
  minReceiveAmount: string;
  destinationAddress: string;
  fee: FeeQuote;
  transaction: TransactionPlan;
  steps: ExecutionStep[];
  /** Human-readable summary of the non-custodial guarantee for this route. */
  custodyModel: string;
  /** Documentation links backing each claim in the plan. */
  references: { label: string; url: string }[];
  createdAt: number;
  expiresAt: number;
}

export interface OrderRecord {
  orderId: string;
  createdAt: number;
  expiresAt: number;
  status:
    | 'awaiting_deposit'
    | 'detecting'
    | 'confirming'
    | 'swapping'
    | 'settling'
    | 'completed'
    | 'expired'
    | 'refunded';
  plan: ExecutionPlan;
  confirmations: number;
  requiredConfirmations: number;
  inboundTxHash?: string;
  outboundTxHash?: string;
}

/** Deposit-proxy order (EVM same-chain, no wallet connect). */
export interface DepositRecord {
  depositId: string;
  /** Alias for UI compat */
  orderId: string;
  createdAt: number;
  expiresAt: number;
  status:
    | 'awaiting_funds'
    | 'funding'
    | 'funded'
    | 'executing'
    | 'executed'
    | 'expired'
    | 'refunded';
  fromAssetId: string;
  toAssetId: string;
  sendAmount: string;
  sendUsd: number;
  receiveAmount: string;
  minReceiveAmount: string;
  destinationAddress: string;
  /** Counterfactual CREATE2 address user funds */
  depositAddress: string;
  factoryAddress: string;
  logicAddress: string;
  chainId: number;
  chain: string;
  aggregator: AggregatorId;
  quote: AggregatorQuote;
  fee: FeeQuote;
  warnings: string[];
  fundedAt?: number;
  txHash?: string;
  outTxHash?: string;
}
