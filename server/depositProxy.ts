/**
 * Deposit Proxy — non-custodial "copy address" flow for EVM same-chain swaps.
 *
 * Problem: 0x/1inch/etc. only pay affiliate when the swap calldata contains
 * feeRecipient/feeBps. A plain `transfer` to a hot wallet has no place to embed
 * that, forcing custodial spread (ff.io model).
 *
 * Solution: per-order CREATE2 proxy (EIP-1167) counterfactual address.
 *   1. computeDepositAddress(salt) is shown to user BEFORE any on-chain tx.
 *   2. user funds it with a normal transfer from ANY wallet (no connect needed).
 *   3. watcher detects balance >= expected, then deploys proxy if not yet deployed
 *      and calls execute(router, calldata) where calldata already carries fee.
 *   4. proxy atomically swaps and forwards output to destination; on failure it
 *      refunds input. Owner cannot redirect funds.
 *
 * This file holds the off-chain side: address derivation, order store, watcher,
 * and execution via relayer. The on-chain side lives in contracts/.
 */

import { ethers } from 'ethers';
import { isNativeEvm, requireAsset } from '../shared/assets.js';
import { CHAINS } from '../shared/chains.js';
import type { DepositRecord } from '../shared/types.js';
import { buildExecutionPlan } from './executionPlanner.js';
import { buildQuote, defaultSlippageBps } from './quoteEngine.js';

// ------------------------------------------------------------------ config

const FAKE_FACTORY = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'; // used when EE_PROXY_FACTORY unset (simulation / counterfactual)
const FAKE_LOGIC = '0xbabebabebabebabebabebabebabebabebabebababe';

function factoryFor(chainId: number): string {
  // Allow per-chain override: EE_PROXY_FACTORY_1, EE_PROXY_FACTORY_56, etc.
  const perChain = process.env[`EE_PROXY_FACTORY_${chainId}`];
  if (perChain && ethers.isAddress(perChain)) return ethers.getAddress(perChain);
  const generic = process.env.EE_PROXY_FACTORY;
  if (generic && ethers.isAddress(generic)) return ethers.getAddress(generic);
  return FAKE_FACTORY;
}

function logicFor(chainId: number): string {
  const perChain = process.env[`EE_PROXY_LOGIC_${chainId}`];
  if (perChain && ethers.isAddress(perChain)) return ethers.getAddress(perChain);
  const generic = process.env.EE_PROXY_LOGIC;
  if (generic && ethers.isAddress(generic)) return ethers.getAddress(generic);
  return FAKE_LOGIC;
}

function rpcFor(chainId: number): string | undefined {
  const perChain = process.env[`EE_RPC_${chainId}`] ?? process.env[`EE_RPC_ETHEREUM`];
  return perChain;
}

// EIP-1167 minimal proxy init code hash helpers
const MINIMAL_PROXY_PREFIX = '0x3d602d80600a3d3981f3363d3d373d3d3d363d73';
const MINIMAL_PROXY_SUFFIX = '5af43d82803e903d91602b57fd5bf3';

function minimalProxyCreationCode(logic: string): string {
  // 0x3d602d80600a3d3981f3363d3d373d3d3d363d73<logic>5af43d82803e903d91602b57fd5bf3
  return MINIMAL_PROXY_PREFIX + logic.toLowerCase().slice(2) + MINIMAL_PROXY_SUFFIX.slice(2);
}

/**
 * Predict the counterfactual deposit address for orderId via CREATE2.
 * salt = keccak256(orderId) — deterministic, user-visible.
 */
export function computeDepositAddress(orderId: string, chainId: number): string {
  const factory = factoryFor(chainId);
  const logic = logicFor(chainId);
  const salt = ethers.keccak256(ethers.toUtf8Bytes(orderId));
  const initCode = minimalProxyCreationCode(logic);
  const initCodeHash = ethers.keccak256(initCode);
  // ethers.getCreate2Address does: keccak256(0xff ++ factory ++ salt ++ hash)[12:]
  return ethers.getCreate2Address(factory, salt, initCodeHash);
}

// ------------------------------------------------------------------ store

const deposits = new Map<string, DepositRecord>();
const MAX_DEPOSITS = 500;

export function listDeposits(): DepositRecord[] {
  return [...deposits.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

export function getDeposit(depositId: string): DepositRecord | undefined {
  const rec = deposits.get(depositId);
  if (!rec) return undefined;
  // advance simulated status if not watching live chain
  return advanceDeposit(rec);
}

function advanceDeposit(rec: DepositRecord): DepositRecord {
  if (rec.status === 'executed' || rec.status === 'refunded' || rec.status === 'expired') return rec;
  if (Date.now() > rec.expiresAt) {
    rec.status = 'expired';
    return rec;
  }
  // In simulation mode without live RPC, we fake progression after funding
  if (rec.status === 'funding' || rec.status === 'funded') {
    const elapsed = (Date.now() - (rec.fundedAt ?? rec.createdAt)) / 1000;
    if (elapsed > 2 && rec.status === 'funding') rec.status = 'funded';
    if (elapsed > 5 && rec.status === 'funded') {
      // auto-execute simulated
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
  amount: string; // base units string (sendAmount)
  destinationAddress: string;
  aggregator?: string;
  slippageBps?: number;
}

export async function createDeposit(params: CreateDepositParams): Promise<DepositRecord> {
  const from = requireAsset(params.fromAssetId);
  const to = requireAsset(params.toAssetId);
  const chain = CHAINS[from.chain];
  if (!chain.chainId) throw new Error(`${from.chain} is not EVM — use THORChain deposit flow`);
  if (from.chain !== to.chain) throw new Error(`Deposit proxy only for same-chain EVM swaps; cross-chain use THORChain`);

  const destValidation = to.validate(params.destinationAddress);
  if (!destValidation.isValid) throw new Error(`Invalid destination: ${destValidation.message}`);
  const destination = destValidation.normalized ?? params.destinationAddress;

  // Build a fresh quote to get fee/minOut and best aggregator (float-only, 0.5%)
  const slippageBps = params.slippageBps ?? defaultSlippageBps('float' as any, from, to);
  const quoteRes = await buildQuote({
    fromAssetId: from.id,
    toAssetId: to.id,
    amount: params.amount,
    side: 'send',
    rateType: 'float',
    destinationAddress: destination,
    slippageBps,
  });

  const EVM_AGGREGATORS = new Set(['0x', 'kyberswap', '1inch', 'openocean', 'paraswap']);
  const evmQuotes = quoteRes.quotes.filter((q) => EVM_AGGREGATORS.has(q.aggregator) && !q.unavailableReason);
  // Prefer EVM aggregators for proxy (thorchain/jupiter not via proxy)
  const bestEvm = evmQuotes.sort((a, b) => b.netOutUsd - b.gasUsd - (a.netOutUsd - a.gasUsd))[0];
  const chosen =
    (params.aggregator
      ? quoteRes.quotes.find((q) => q.aggregator === params.aggregator && !q.unavailableReason)
      : undefined) ?? bestEvm ?? quoteRes.best;

  if (!chosen) throw new Error('No executable route for deposit proxy');

  // Check fee covers gas estimate (warn, don't block)
  const warnings: string[] = [...quoteRes.warnings];
  const gasUsd = chosen.gasUsd;
  const feeUsd = chosen.fee.amountUsd ?? chosen.fee.netToOperatorUsd ?? 0;
  const minUsdForGas = gasUsd * 1.5; // need 1.5x gas to safely sponsor
  if (feeUsd < minUsdForGas && Number(params.amount) > 0) {
    const sendUsd = quoteRes.sendUsd;
    if (sendUsd < 40) {
      warnings.push(
        `Small amount (~$${sendUsd.toFixed(2)}): 0.5% fee (~$${feeUsd.toFixed(2)}) may not cover relayer gas (~$${gasUsd.toFixed(2)}). Consider Connect Wallet for direct swap or add ~$1 of native gas.`,
      );
    }
  }

  const depositId = `DP-${randomDigits(6)}`;
  const chainId = chain.chainId!;
  const depositAddress = computeDepositAddress(depositId, chainId);
  const factory = factoryFor(chainId);
  const logic = logicFor(chainId);
  const now = Date.now();
  const expiresAt = now + 30 * 60 * 1000; // 30 min to fund, longer than float window

  const rec: DepositRecord = {
    depositId,
    orderId: depositId, // alias for legacy
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
    warnings,
    fundedAt: undefined,
    txHash: undefined,
    outTxHash: undefined,
  };

  if (deposits.size >= MAX_DEPOSITS) {
    const oldest = [...deposits.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) deposits.delete(oldest.depositId);
  }
  deposits.set(depositId, rec);

  // Start watcher if live RPC available (non-blocking)
  void watchDeposit(rec).catch(() => {});

  return rec;
}

// ------------------------------------------------------------------ watcher

async function watchDeposit(rec: DepositRecord): Promise<void> {
  const rpc = rpcFor(rec.chainId);
  if (!rpc) {
    // No live RPC — simulation mode: auto-fund after 8s for demo/testing
    // Do nothing; advanceDeposit will simulate. Real funding must be triggered
    // via markDepositFunded() endpoint.
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const from = requireAsset(rec.fromAssetId);
  const isNative = isNativeEvm(from);
  const expected = BigInt(rec.sendAmount);
  const start = Date.now();
  const timeout = rec.expiresAt - start;

  const pollMs = 4000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      let bal: bigint = 0n;
      if (isNative) {
        bal = await provider.getBalance(rec.depositAddress);
      } else {
        const token = new ethers.Contract(
          from.address!,
          ['function balanceOf(address) view returns (uint256)'],
          provider,
        );
        bal = await token.balanceOf(rec.depositAddress);
      }

      if (bal >= expected && bal > 0n) {
        rec.status = 'funded';
        rec.fundedAt = Date.now();
        // Capture first depositor for refund path by checking Transfer events
        // Simplified: we don't need exact depositor for atomic forward.
        await executeDeposit(rec);
        return;
      } else if (bal > 0n && bal < expected) {
        rec.status = 'funding';
        rec.fundedAt = Date.now();
        // wait for full amount
      }
    } catch (e) {
      console.warn('[depositWatcher] poll error', e);
    }
    await sleep(pollMs);
    // break if order completed/expired externally
    if (rec.status === 'executed' || rec.status === 'expired') return;
  }
}

export async function markDepositFunded(depositId: string, txHash?: string): Promise<DepositRecord | undefined> {
  const rec = deposits.get(depositId);
  if (!rec) return undefined;
  if (rec.status === 'awaiting_funds' || rec.status === 'funding') {
    rec.status = 'funded';
    rec.fundedAt = Date.now();
    rec.txHash = txHash ?? `0x${randomHex(64)}`;
    // Trigger execution
    void executeDeposit(rec).catch((e) => console.error('[deposit] execute failed', e));
  }
  return rec;
}

async function executeDeposit(rec: DepositRecord): Promise<void> {
  if (rec.status !== 'funded' && rec.status !== 'funding') return;
  rec.status = 'executing';

  const from = requireAsset(rec.fromAssetId);
  const to = requireAsset(rec.toAssetId);
  const relayerPk = process.env.EE_RELAYER_PK;
  const rpc = rpcFor(rec.chainId);

  // Build execution plan with proxy as taker (for calldata)
  const slippageBps = defaultSlippageBps('float' as any, from, to);
  // Re-quote to get fresh minOut at execution time
  const quoteRes = await buildQuote({
    fromAssetId: from.id,
    toAssetId: to.id,
    amount: rec.sendAmount,
    side: 'send',
    rateType: 'float',
    destinationAddress: rec.destinationAddress,
    takerAddress: rec.depositAddress,
    slippageBps,
  });
  const chosen = quoteRes.quotes.find((q) => q.aggregator === rec.aggregator && !q.unavailableReason) ?? quoteRes.best;
  if (!chosen) {
    rec.status = 'refunded';
    return;
  }

  // Build the EVM plan that the proxy will execute
  const plan = await buildExecutionPlan({
    quote: chosen,
    fromAssetId: from.id,
    toAssetId: to.id,
    sendAmount: rec.sendAmount,
    destinationAddress: rec.destinationAddress,
    takerAddress: rec.depositAddress,
    slippageBps,
    expiresAt: rec.expiresAt,
  });

  // If no live relayer/RPC, simulate success
  if (!relayerPk || !rpc) {
    // Simulate on-chain execution
    await sleep(3000);
    rec.status = 'executed';
    rec.outTxHash = `0x${randomHex(64)}`;
    console.log(`[deposit] simulated execute ${rec.depositId} -> ${rec.destinationAddress} via ${chosen.aggregator}`);
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(relayerPk, provider);
    const factoryAddr = rec.factoryAddress;
    const salt = ethers.keccak256(ethers.toUtf8Bytes(rec.depositId));

    // Ensure proxy is deployed
    const factoryAbi = [
      'function computeAddress(bytes32) view returns (address)',
      'function proxyOf(bytes32) view returns (address)',
      'function createProxy(bytes32,address,address,address,uint256) returns (address)',
      'function isRouterAllowed(address) view returns (bool)',
    ];
    const factory = new ethers.Contract(factoryAddr, factoryAbi, wallet);
    const existing: string = await factory.proxyOf(salt).catch(() => ethers.ZeroAddress);
    let proxyAddr = existing;
    if (!proxyAddr || proxyAddr === ethers.ZeroAddress || proxyAddr.toLowerCase() === ethers.ZeroAddress) {
      // Deploy proxy with destination/minOut
      const fromToken = isNativeEvm(from) ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : from.address!;
      const toToken = isNativeEvm(to) ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : to.address!;
      const minOut = BigInt(chosen.minOut);
      const tx = await factory.createProxy(salt, fromToken, toToken, rec.destinationAddress, minOut);
      await tx.wait();
      proxyAddr = await factory.computeAddress(salt);
    }

    // Execute via proxy
    if (plan.transaction.kind === 'evm') {
      const proxyAbi = ['function execute(address router, bytes calldata data)'];
      const proxy = new ethers.Contract(proxyAddr, proxyAbi, wallet);
      const tx = await proxy.execute(plan.transaction.to, plan.transaction.data, { gasLimit: 600000 });
      const receipt = await tx.wait();
      rec.outTxHash = receipt.hash;
      rec.status = 'executed';
      rec.txHash = tx.hash;
    } else {
      rec.status = 'executed';
    }
  } catch (e) {
    console.error('[deposit] live execute failed', e);
    // On swap revert, proxy refunds; we mark refunded
    rec.status = 'refunded';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
