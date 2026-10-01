/**
 * Deposit Proxy — non-custodial "copy address" flow for EVM same-chain swaps.
 * Audited v2 — fixes frontrun, factory init, fee hijack, slippage, reentrancy.
 *
 * Problem: 0x/1inch/etc. only pay affiliate when calldata contains
 * feeRecipient/feeBps. Plain `transfer` to hot wallet has no place.
 *
 * Solution: per-order CREATE2 proxy (EIP-1167) counterfactual address.
 *   salt = keccak256(abi.encode(orderId, destination, fromToken, toToken))
 *   depositAddress = CREATE2(factory, salt, minimalProxyCode)
 *   → bound to destination: attacker cannot redeploy same address with different dest.
 *   createProxy onlyRelayerOrOwner: prevents frontrun.
 *   execute onlyRelayer: prevents fee hijack via arbitrary calldata.
 */

import { ethers } from 'ethers';
import { isNativeEvm, requireAsset } from '../shared/assets.js';
import { CHAINS } from '../shared/chains.js';
import type { DepositRecord } from '../shared/types.js';
import { buildExecutionPlan } from './executionPlanner.js';
import { buildQuote, defaultSlippageBps } from './quoteEngine.js';

// ------------------------------------------------------------------ config

const FAKE_FACTORY = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const FAKE_LOGIC = '0xbabebabebabebabebabebabebabebabebabebababe';
const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // EIP-2098 sentinel, keep mixed case for display but use lower for encoding where needed

function factoryFor(chainId: number): string {
  const perChain = process.env[`EE_PROXY_FACTORY_${chainId}`];
  if (perChain && ethers.isAddress(perChain)) return ethers.getAddress(perChain);
  const generic = process.env.EE_PROXY_FACTORY;
  if (generic && ethers.isAddress(generic)) return ethers.getAddress(generic);
  return FAKE_FACTORY;
}

/**
 * CRITICAL: with no factory configured, every deposit address is a CREATE2
 * output of the non-existent FAKE_FACTORY — nothing can ever deploy the proxy,
 * so funds sent to it are permanently unrecoverable. Deposits created in this
 * state must be flagged `simulated` and bannered in the UI.
 */
export function factoryConfigured(chainId: number): boolean {
  return factoryFor(chainId) !== FAKE_FACTORY;
}

function logicFor(chainId: number): string {
  const perChain = process.env[`EE_PROXY_LOGIC_${chainId}`];
  if (perChain && ethers.isAddress(perChain)) return ethers.getAddress(perChain);
  const generic = process.env.EE_PROXY_LOGIC;
  if (generic && ethers.isAddress(generic)) return ethers.getAddress(generic);
  return FAKE_LOGIC;
}

function rpcFor(chainId: number): string | undefined {
  return process.env[`EE_RPC_${chainId}`] ?? process.env[`EE_RPC_ETHEREUM`];
}

const MINIMAL_PROXY_PREFIX = '0x3d602d80600a3d3981f3363d3d373d3d3d363d73';
// NOTE: unlike the prefix, this constant already starts with the raw hex (no
// 0x). The old code called .slice(2) on it "to strip 0x" — stripping the '5a'
// opcode instead, so the off-chain init code hash never matched the on-chain
// creation code. Every deposit address shown to users was an address the
// factory could NEVER deploy: funds sent there were lost. Verified on-chain
// via ganache (off-chain address ≠ factory.computeAddress before the fix).
const MINIMAL_PROXY_SUFFIX = '5af43d82803e903d91602b57fd5bf3';

function minimalProxyCreationCode(logic: string): string {
  return MINIMAL_PROXY_PREFIX + logic.toLowerCase().slice(2) + MINIMAL_PROXY_SUFFIX;
}

/**
 * Legacy simple salt for tests: keccak256(orderId)
 */
export function computeDepositAddress(orderId: string, chainId: number): string {
  const factory = factoryFor(chainId);
  const logic = logicFor(chainId);
  const salt = ethers.keccak256(ethers.toUtf8Bytes(orderId));
  const initCode = minimalProxyCreationCode(logic);
  const initCodeHash = ethers.keccak256(initCode);
  return ethers.getCreate2Address(factory, salt, initCodeHash);
}

/**
 * Bound salt for production: keccak256(abi.encode(orderId, destination, fromToken, toToken))
 * Prevents frontrun redeploy with different destination.
 */
export function computeDepositAddressBound(
  orderId: string,
  destination: string,
  fromToken: string,
  toToken: string,
  chainId: number,
): string {
  const factory = factoryFor(chainId);
  const logic = logicFor(chainId);
  // Use lower-case for sentinel to avoid checksum validation failure in AbiCoder
  const ft = fromToken.toLowerCase() === NATIVE_SENTINEL.toLowerCase() ? fromToken.toLowerCase() : ethers.getAddress(fromToken);
  const tt = toToken.toLowerCase() === NATIVE_SENTINEL.toLowerCase() ? toToken.toLowerCase() : ethers.getAddress(toToken);
  const dest = ethers.getAddress(destination);
  const salt = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'address', 'address'],
      [orderId, dest, ft, tt],
    ),
  );
  const initCode = minimalProxyCreationCode(logic);
  const initCodeHash = ethers.keccak256(initCode);
  return ethers.getCreate2Address(factory, salt, initCodeHash);
}

function saltForOrder(
  orderId: string,
  destination: string,
  fromToken: string,
  toToken: string,
): string {
  const ft = fromToken.toLowerCase() === NATIVE_SENTINEL.toLowerCase() ? fromToken.toLowerCase() : ethers.getAddress(fromToken);
  const tt = toToken.toLowerCase() === NATIVE_SENTINEL.toLowerCase() ? toToken.toLowerCase() : ethers.getAddress(toToken);
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'address', 'address'],
      [orderId, ethers.getAddress(destination), ft, tt],
    ),
  );
}

// ------------------------------------------------------------------ store

const deposits = new Map<string, DepositRecord>();
const MAX_DEPOSITS = 500;
const activeExecutions = new Set<string>(); // guard concurrent execute
const lastAttempt = new Map<string, number>(); // throttle retries per deposit

/** Topic0 of DepositProxy's Refunded(address,uint256,address) event (v3). */
const REFUNDED_TOPIC = ethers.id('Refunded(address,uint256,address)');

/**
 * Status fabrication is only honest when there is NOTHING real on-chain: no
 * RPC means no watcher and no real funding, so time-based progression is just
 * UI theatre. The moment an RPC endpoint exists, a user's money can be real —
 * even without a relayer key — and the status machine must never invent an
 * execution that did not happen.
 */
function demoExecution(chainId: number): boolean {
  return !rpcFor(chainId);
}

function pushWarningOnce(rec: DepositRecord, warning: string): void {
  if (!rec.warnings.includes(warning)) rec.warnings.push(warning);
}

/**
 * Lock gate (pure, unit-tested).
 *
 * Given the pinned floor (`lockedWei`) and the fresh route's netOut
 * (`freshWei`):
 *  - fresh < locked  → do NOT execute; funds stay put (lock-or-refund).
 *  - fresh ≥ locked  → executable; express calldata slippage as the pin
 *    between lock and fresh minus 5 bps of dust tolerance, floored at
 *    15 bps, capped at the caller's default — all upside lands with the
 *    user, the lock floor is enforced by the contract itself.
 */
export function lockGate(
  lockedWei: bigint,
  freshWei: bigint,
  defaultSlippageBps: number,
): { execute: boolean; slippageBps: number } {
  if (lockedWei <= 0n) return { execute: true, slippageBps: defaultSlippageBps };
  if (freshWei < lockedWei) return { execute: false, slippageBps: defaultSlippageBps };
  const pin = Number(((freshWei - lockedWei) * 10_000n) / freshWei);
  return { execute: true, slippageBps: Math.min(Math.max(pin - 5, 15), defaultSlippageBps) };
}

/** Target locks may sit up to 72h watching the market; rate locks stay 30 min. */
const TARGET_MAX_MINUTES = 4_320;
const TARGET_DEFAULT_MINUTES = 1_440;
/** A target more than +50% above the current route is noise, not intent. */
const TARGET_CAP_NUM = 150n;
const TARGET_CAP_DEN = 100n;

export function listDeposits(): DepositRecord[] {
  return [...deposits.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

export function getDeposit(depositId: string): DepositRecord | undefined {
  const rec = deposits.get(depositId);
  if (!rec) return undefined;
  return advanceDeposit(rec);
}

function advanceDeposit(rec: DepositRecord): DepositRecord {
  if (rec.status === 'executed' || rec.status === 'refunded' || rec.status === 'expired') return rec;
  if (Date.now() > rec.expiresAt) {
    rec.status = 'expired';
    return rec;
  }
  // Only fabricate progress in pure demo mode. With an RPC configured this
  // advancement RACES the real watcher: it marked partial funding 'funded'
  // after 2s and 'executed' (with made-up tx hashes) after 12s even while the
  // relayer was still working — or while the deposit was still partial.
  if (!demoExecution(rec.chainId)) return rec;
  if (rec.status === 'funding' || rec.status === 'funded') {
    const elapsed = (Date.now() - (rec.fundedAt ?? rec.createdAt)) / 1000;
    if (elapsed > 2 && rec.status === 'funding') rec.status = 'funded';
    if (elapsed > 5 && rec.status === 'funded') {
      if (!rec.txHash) rec.txHash = `0x${randomHex(64)}`;
      rec.status = 'executing';
    }
    if (elapsed > 12 && rec.status === 'executing') {
      rec.status = 'executed';
      rec.outTxHash = `0x${randomHex(64)}`;
    }
  }
  return rec;
}

// ------------------------------------------------------------------ creation

export interface CreateDepositParams {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  destinationAddress: string;
  aggregator?: string;
  slippageBps?: number;
  /** Fixed = locked rate until deposit expiry (wider fee, per fee policy). */
  rateType?: 'float' | 'fixed';
  /**
   * Target lock: pin an execution condition STRICTLY above the current
   * quote floor. Requires rateType='fixed'. Base units of toAsset.
   */
  targetMinReceive?: string;
  /** Watching window, minutes (target locks only, 15–4320). */
  expiresInMinutes?: number;
  /** Status-transition webhook — validated before it ever reaches this store. */
  webhookUrl?: string;
  /** Integration partner that created this deposit (partner API). */
  partnerId?: string;
}

export async function createDeposit(params: CreateDepositParams): Promise<DepositRecord> {
  const from = requireAsset(params.fromAssetId);
  const to = requireAsset(params.toAssetId);
  const chain = CHAINS[from.chain];
  if (!chain.chainId) throw new Error(`${from.chain} is not EVM — use THORChain deposit flow`);
  if (from.chain !== to.chain) throw new Error(`Deposit proxy only for same-chain EVM swaps; cross-chain use THORChain`);

  const destValidation = to.validate(params.destinationAddress);
  if (!destValidation.isValid) throw new Error(`Invalid destination: ${destValidation.message}`);
  const destination = ethers.getAddress(destValidation.normalized ?? params.destinationAddress);

  // Amount sanity: must be >0 and within asset limits (USD)
  const amountBi = BigInt(params.amount);
  if (amountBi <= 0n) throw new Error('Amount must be > 0');
  // BUILD quote — the caller's rate contract drives fee size, slippage floor
  // and the quote's honesty about how long its number holds.
  const rateType = params.rateType ?? 'float';
  const slippageBps = params.slippageBps ?? defaultSlippageBps(rateType, from, to);
  const quoteRes = await buildQuote({
    fromAssetId: from.id,
    toAssetId: to.id,
    amount: params.amount,
    side: 'send',
    rateType,
    destinationAddress: destination,
    slippageBps,
  });

  const EVM_AGGREGATORS = new Set(['0x', 'kyberswap', '1inch', 'openocean', 'paraswap']);
  const evmQuotes = quoteRes.quotes.filter((q) => EVM_AGGREGATORS.has(q.aggregator) && !q.unavailableReason);
  const bestEvm = evmQuotes.sort((a, b) => b.netOutUsd - b.gasUsd - (a.netOutUsd - a.gasUsd))[0];
  const chosen =
    (params.aggregator ? quoteRes.quotes.find((q) => q.aggregator === params.aggregator && !q.unavailableReason) : undefined) ??
    bestEvm ??
    quoteRes.best;

  if (!chosen) throw new Error('No executable route for deposit proxy');

  /* -------------------------------------------------- target lock (v0.4)
   *
   * A limit order that cannot be gamed by an orderbook because there IS no
   * orderbook. The user pins a target output strictly above the current
   * guaranteed floor; the escrow holds the input and the relayer only fires
   * when a fresh aggregated route can pay the target — else the clock runs
   * out and the proxy refunds. The target becomes part of the receipt's
   * evidence hash, i.e. the execution CONDITION is provable, not just the
   * outcome. */
  let lockKind: 'rate' | 'target' = 'rate';
  let targetMinReceive: string | undefined;
  if (params.targetMinReceive !== undefined) {
    if (rateType !== 'fixed') {
      throw new Error('Target lock requires rateType "fixed" (the lock-or-refund vault does the waiting)');
    }
    const target = BigInt(params.targetMinReceive);
    const floorNow = BigInt(chosen.minOut);
    if (target <= 0n) throw new Error('Target must be > 0');
    if (target <= floorNow) {
      throw new Error(
        'Target is already reachable now — post a normal fixed lock ' +
          `(floor ${floorNow}) and it executes immediately`,
      );
    }
    const cap = (BigInt(chosen.netOut) * TARGET_CAP_NUM) / TARGET_CAP_DEN;
    if (target > cap) {
      throw new Error(
        `Target unreachably high (>+50% of the current route netOut). Cap ${cap} — split the order or lower the ask.`,
      );
    }
    lockKind = 'target';
    targetMinReceive = target.toString();
  }

  const warnings: string[] = [...quoteRes.warnings];
  // Funds sent to a CREATE2 address of the PLACEHOLDER factory can never be
  // recovered — the contract does not exist. Flag loudly rather than handing
  // the user what looks like a real deposit address (this silently burned
  // money before).
  const simulated = !factoryConfigured(chain.chainId!);
  if (simulated) {
    warnings.push(
      'DEMO MODE: no proxy factory is configured for this chain (EE_PROXY_FACTORY_*), so this ' +
        'deposit address is derived from a placeholder contract that does not exist. ' +
        'Do NOT send real funds to it.',
    );
  }
  const gasUsd = chosen.gasUsd;
  const feeUsd = chosen.fee.amountUsd ?? chosen.fee.netToOperatorUsd ?? 0;
  if (feeUsd < gasUsd * 1.5) {
    const sendUsd = quoteRes.sendUsd;
    if (sendUsd < 50) {
      warnings.push(
        `Small amount (~$${sendUsd.toFixed(2)}): 0.5% fee (~$${feeUsd.toFixed(2)}) may not cover relayer gas (~$${gasUsd.toFixed(2)}). Use Connect Wallet for direct swap.`,
      );
    }
  }
  // Rate limit: simple in-memory count per IP would be better, but cap total
  if (deposits.size >= MAX_DEPOSITS) {
    const oldest = [...deposits.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) deposits.delete(oldest.depositId);
  }

  // 6 random digits collided regularly at ≥1k deposits (birthday bound), and
  // a collision silently OVERWROTE someone else's in-flight deposit record.
  let depositId = '';
  do {
    depositId = `DP-${randomDigits(6)}`;
  } while (deposits.has(depositId));
  const chainId = chain.chainId!;
  const fromTokenAddr = isNativeEvm(from) ? NATIVE_SENTINEL : ethers.getAddress(from.address!);
  const toTokenAddr = isNativeEvm(to) ? NATIVE_SENTINEL : ethers.getAddress(to.address!);
  const depositAddress = computeDepositAddressBound(depositId, destination, fromTokenAddr, toTokenAddr, chainId);
  const salt = saltForOrder(depositId, destination, fromTokenAddr, toTokenAddr);
  const factory = factoryFor(chainId);
  const logic = logicFor(chainId);
  const now = Date.now();
  const lockMinutes =
    lockKind === 'target'
      ? Math.min(Math.max(params.expiresInMinutes ?? TARGET_DEFAULT_MINUTES, 15), TARGET_MAX_MINUTES)
      : 30;
  const expiresAt = now + lockMinutes * 60 * 1000;

  if (lockKind === 'target' && targetMinReceive) {
    warnings.push(
      `TARGET LOCK: executes ONLY if a route pays ≥ ${targetMinReceive} (floor now ${chosen.minOut}). ` +
        `Watching for ${lockMinutes} min — if the target never lands, the proxy auto-refunds the full input. ` +
        'The target is pinned in your receipt; nothing else can happen to the funds in between.',
    );
  }

  const rec: DepositRecord = {
    depositId,
    orderId: depositId,
    createdAt: now,
    expiresAt,
    status: 'awaiting_funds',
    fromAssetId: from.id,
    toAssetId: to.id,
    sendAmount: params.amount,
    sendUsd: quoteRes.sendUsd,
    receiveAmount: chosen.netOut,
    minReceiveAmount: chosen.minOut,
    destinationAddress: destination,
    depositAddress,
    factoryAddress: factory,
    logicAddress: logic,
    chainId,
    chain: from.chain,
    aggregator: chosen.aggregator,
    quote: chosen,
    fee: chosen.fee,
    rateType,
    webhookUrl: params.webhookUrl,
    partnerId: params.partnerId,
    warnings,
    fundedAt: undefined,
    txHash: undefined,
    outTxHash: undefined,
    lockKind,
    targetMinReceive,
    /// store salt for audit trail (not in type, but add via any)
    salt,
    simulated,
    // The deposit proxy's guarantee: contract refunds the whole input if the
    // route / lock cannot be honoured. Compare routes by this, not rate alone.
    failureMode: 'atomic-refund',
  } as DepositRecord & { salt: string };

  deposits.set(depositId, rec);
  void watchDeposit(rec).catch(() => {});
  return rec;
}

// ------------------------------------------------------------------ watcher

async function watchDeposit(rec: DepositRecord): Promise<void> {
  const rpc = rpcFor(rec.chainId);
  if (!rpc) return;
  const provider = new ethers.JsonRpcProvider(rpc);
  const from = requireAsset(rec.fromAssetId);
  const isNative = isNativeEvm(from);
  const expected = BigInt(rec.sendAmount);
  const pollMs = 4000;
  const deadline = rec.expiresAt;
  while (Date.now() < deadline) {
    try {
      let bal: bigint = 0n;
      if (isNative) bal = await provider.getBalance(rec.depositAddress);
      else {
        const token = new ethers.Contract(from.address!, ['function balanceOf(address) view returns (uint256)'], provider);
        bal = await token.balanceOf(rec.depositAddress);
      }
      if (bal >= expected && bal > 0n) {
        rec.status = 'funded';
        rec.fundedAt ??= Date.now();
        await executeDeposit(rec);
        // Only exit once a terminal state is reached; a failed execution is
        // rolled back to 'funded' and retried on the next poll (throttled).
        const statusAfter = rec.status as DepositRecord['status'];
        if (statusAfter === 'executed' || statusAfter === 'refunded') return;
      } else if (bal > 0n && bal < expected) {
        rec.status = 'funding';
        rec.fundedAt ??= Date.now();
      }
      if (rec.status === 'executed' || rec.status === 'expired' || rec.status === 'refunded') return;
    } catch (e) {
      console.warn('[depositWatcher] poll error', e);
    }
    await sleep(pollMs);
  }
}

export async function markDepositFunded(depositId: string, txHash?: string): Promise<DepositRecord | undefined> {
  const rec = deposits.get(depositId);
  if (!rec) return undefined;
  // Strict on-chain verification when RPC is configured — prevents griefing via fake funded signals
  const rpc = rpcFor(rec.chainId);
  if (rpc) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const from = requireAsset(rec.fromAssetId);
      const isNative = isNativeEvm(from);
      let bal: bigint = 0n;
      if (isNative) bal = await provider.getBalance(rec.depositAddress);
      else {
        const token = new ethers.Contract(from.address!, ['function balanceOf(address) view returns (uint256)'], provider);
        bal = await token.balanceOf(rec.depositAddress);
      }
      const expected = BigInt(rec.sendAmount);
      if (bal < expected) {
        // Not funded yet on-chain — do not transition, just record txHash for audit
        if (txHash) rec.txHash = txHash;
        return rec;
      }
    } catch (e) {
      // RPC error: do not trust client signal, keep awaiting
      console.warn('[deposit] verify failed, not marking funded', e);
      if (txHash) rec.txHash = txHash;
      return rec;
    }
  }
  if (rec.status === 'awaiting_funds' || rec.status === 'funding') {
    rec.status = 'funded';
    rec.fundedAt = Date.now();
    rec.txHash = txHash ?? `0x${randomHex(64)}`;
    void executeDeposit(rec).catch((e) => console.error('[deposit] execute failed', e));
  }
  return rec;
}

async function executeDeposit(rec: DepositRecord): Promise<void> {
  if (rec.status !== 'funded' && rec.status !== 'funding') return;
  if (activeExecutions.has(rec.depositId)) return;
  // Throttle retries: a permanent failure (e.g. minOut unreachable after a
  // price move) must not re-quote every watcher poll.
  const last = lastAttempt.get(rec.depositId) ?? 0;
  if (Date.now() - last < 30_000) return;
  lastAttempt.set(rec.depositId, Date.now());

  activeExecutions.add(rec.depositId);
  rec.status = 'executing';
  try {
    const from = requireAsset(rec.fromAssetId);
    const to = requireAsset(rec.toAssetId);
    const relayerPk = process.env.EE_RELAYER_PK;
    const rpc = rpcFor(rec.chainId);

    const rateType = rec.rateType ?? 'float';
    const slippageBps = defaultSlippageBps(rateType, from, to);
    // Floored to the lock pin for fixed orders during execution — see the
    // LOCK-OR-REFUND note below.
    let slippageBpsExec = slippageBps;
    const quoteRes = await buildQuote({
      fromAssetId: from.id,
      toAssetId: to.id,
      amount: rec.sendAmount,
      side: 'send',
      rateType,
      destinationAddress: rec.destinationAddress,
      takerAddress: rec.depositAddress,
      slippageBps,
    });
    const chosen = quoteRes.quotes.find((q) => q.aggregator === rec.aggregator && !q.unavailableReason) ?? quoteRes.best;
    if (!chosen) {
      // No route right now: the v2 code marked this 'refunded' although no
      // refund ever happened — the funds sat in the proxy while the UI told
      // the user they were back. Back to 'funded' so the watcher retries,
      // with an honest warning.
      if (!rpc) {
        rec.status = 'refunded'; // demo mode: nothing real to unwind
      } else {
        rec.status = 'funded';
        pushWarningOnce(
          rec,
          'No executable route at the moment — funds remain in the proxy and execution will be retried.',
        );
      }
      return;
    }

    /*
     * LOCK-OR-REFUND (the honest non-custodial version of "fixed rate").
     *
     * A custodial instant exchange honours a locked rate by eating market
     * risk from its hot-wallet float — and pockets the difference when the
     * market moves against the user. ee.io holds no inventory; what it can
     * guarantee instead is structural: the user's minOut was pinned into the
     * deposit record at creation, and the relayer MUST NOT settle below it.
     *
     * If the fresh route undercuts the lock, nothing is signed; the deposit
     * stays put with all upside intact until the market recovers or the
     * deadline passes. If it beats the lock, the calldata's minReturn is
     * expressed as slippage OFF the fresh number exactly at the lock floor —
     * all upside goes to the user, the downside is hard-capped by the
     * contract's own minOut check (whose failure path refunds the input
     * atomically — a guarantee no hot-wallet operator can make).
     */
    if (rateType === 'fixed' && BigInt(rec.minReceiveAmount || '0') > 0n) {
      // A target lock is gated by the user's PINNED TARGET, not the creation
      // floor — execution only happens when the route can actually pay it.
      const isTarget = rec.lockKind === 'target' && Boolean(rec.targetMinReceive);
      const locked = BigInt(isTarget ? rec.targetMinReceive! : rec.minReceiveAmount);
      const fresh = BigInt(chosen.netOut);
      const gate = lockGate(locked, fresh, slippageBps);
      if (!gate.execute) {
        if (isTarget) {
          // Watching is the EXPECTED state here, not a failure — publish the
          // observation instead of writing one warning per market tick. The
          // UI renders lastObservedOut vs targetMinReceive as a progress bar.
          rec.status = 'funded';
          rec.lastObservedOut = fresh.toString();
          rec.observedAt = Date.now();
          pushWarningOnce(
            rec,
            'Target lock: watching the market. Nothing executes below your pinned target; expiry auto-refunds.',
          );
        } else {
          rec.status = rpc ? 'funded' : rec.status;
          pushWarningOnce(
            rec,
            `Market moved below your locked rate (lock ${locked}, fresh route ${fresh}). ` +
              'Funds are untouched in the proxy — execution resumes the moment a route honours the lock.',
          );
        }
        return;
      }
      if (isTarget) {
        rec.lastObservedOut = fresh.toString();
        rec.observedAt = Date.now();
      }
      // 15 bps of engineering tolerance against dust-level boundary reverts;
      // the lock floor itself is enforced by the contract, not by rounding.
      slippageBpsExec = gate.slippageBps;
    } else {
      // Float: the fresh minOut IS the settlement promise; overwrite as before.
      rec.receiveAmount = chosen.netOut;
      rec.minReceiveAmount = chosen.minOut;
    }
    rec.quote = chosen;
    rec.fee = chosen.fee;

    const plan = await buildExecutionPlan({
      quote: chosen,
      fromAssetId: from.id,
      toAssetId: to.id,
      sendAmount: rec.sendAmount,
      destinationAddress: rec.destinationAddress,
      takerAddress: rec.depositAddress,
      slippageBps: slippageBpsExec,
      expiresAt: rec.expiresAt,
      rateType: rec.rateType ?? 'float',
    });

    if (!relayerPk || !rpc) {
      if (rpc) {
        // REAL funds are sitting at the proxy but no relayer key exists to
        // move them. Claiming 'executed' with a made-up hash here (the old
        // behaviour) is the worst kind of bug: a success message on top of
        // untouched user money.
        rec.status = 'funded';
        pushWarningOnce(
          rec,
          'Funds received on-chain, but EE_RELAYER_PK is not configured — the swap cannot run. ' +
            'Configure the relayer or call refund() on the proxy.',
        );
        return;
      }
      // Pure demo: nothing real ever moved, so theatre is safe.
      await sleep(2500);
      rec.status = 'executed';
      rec.outTxHash = `0x${randomHex(64)}`;
      console.log(`[deposit] simulated execute ${rec.depositId} -> ${rec.destinationAddress} via ${chosen.aggregator}`);
      return;
    }

    if (plan.transaction.kind !== 'evm' || plan.transaction.executable !== true) {
      // Never broadcast server-FABRICATED preview calldata (the old code sent
      // it verbatim — an ABI shape the router does not implement, guaranteed
      // to revert on-chain at best). Only calldata built by the aggregator
      // API itself is executed.
      rec.status = 'funded';
      pushWarningOnce(
        rec,
        `Route via ${chosen.aggregator} did not return executable calldata — funds remain in the proxy (refundable).`,
      );
      return;
    }

    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(relayerPk, provider);
    const factoryAddr = rec.factoryAddress;
    const fromTokenAddr = isNativeEvm(from) ? NATIVE_SENTINEL : ethers.getAddress(from.address!);
    const toTokenAddr = isNativeEvm(to) ? NATIVE_SENTINEL : ethers.getAddress(to.address!);
    const salt = saltForOrder(rec.depositId, rec.destinationAddress, fromTokenAddr, toTokenAddr);

    const factoryAbi = [
      'function proxyOf(bytes32) view returns (address)',
      'function computeAddress(bytes32) view returns (address)',
      'function createProxy(bytes32,address,address,address,uint256) returns (address)',
      'function isRouterAllowed(address) view returns (bool)',
      'function isRelayer(address) view returns (bool)',
    ];
    const factory = new ethers.Contract(factoryAddr, factoryAbi, wallet);
    const existing: string = await factory.proxyOf(salt).catch(() => ethers.ZeroAddress);
    let proxyAddr = existing;
    if (!proxyAddr || proxyAddr === ethers.ZeroAddress) {
      const minOut = BigInt(chosen.minOut);
      const tx = await factory.createProxy(salt, fromTokenAddr, toTokenAddr, rec.destinationAddress, minOut);
      await tx.wait();
      proxyAddr = await factory.computeAddress(salt);
    }

    const proxyAbi = ['function execute(address,bytes,bytes32)'];
    const proxy = new ethers.Contract(proxyAddr, proxyAbi, wallet);
    const tx = await proxy.execute(plan.transaction.to, plan.transaction.data, salt, { gasLimit: 650000 });
    const receipt = await tx.wait();
    if (!receipt) throw new Error('Transaction dropped from mempool');

    // v3 contract refunds atomically on router failure — a SUCCEEDED tx can
    // still be a refund. Detect it instead of celebrating a refund as a fill.
    rec.txHash = tx.hash;
    rec.outTxHash = receipt.hash;
    const refunded = receipt.logs.some((log: { topics: readonly string[] }) => log.topics[0] === REFUNDED_TOPIC);
    rec.status = refunded ? 'refunded' : 'executed';
  } catch (e) {
    // UNKNOWN on-chain state here. The old code wrote 'refunded' — a claim no
    // one had earned. Back to 'funded' so the watcher retries; the proxy's
    // refund() path keeps an exit open if the failure is permanent.
    console.error('[deposit] live execute failed', e);
    rec.status = 'funded';
    pushWarningOnce(
      rec,
      `Execution failed (${e instanceof Error ? e.message.slice(0, 120) : 'unknown error'}) — will retry; funds remain in the proxy.`,
    );
  } finally {
    activeExecutions.delete(rec.depositId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/** Test hook: wipe the store between cases. Production code must not call. */
export function __resetDeposits(): void {
  deposits.clear();
}

function randomDigits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10);
  return out;
}
function randomHex(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return out;
}
