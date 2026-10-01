/**
 * Evidence receipt.
 *
 * Every custodial instant exchange claims "we processed your swap". The
 * parasite's version of the same claim can be *provable*: the immutable terms
 * of the order (ids, amounts, CREATE2 coordinates, fee, locked floor) digest-
 * hashed at export time so the payer, an accountant or a dispute channel can
 * hold a self-describing JSON artifact whose evidence hash recomputes with
 * any keccak implementation, forever, without trusting ee.io to keep serving
 * it.
 *
 * The hash deliberately excludes volatile state (status, confirmations, tx
 * hashes). Those are included in the payload alongside, but the evidence
 * digest identifies only the *terms* — the thing that must not be able to
 * drift after the fact.
 */

import { keccak_256 } from '../shared/keccak.js';
import type { DepositRecord, OrderRecord } from '../shared/types.js';

interface HashableFields {
  [k: string]: string | number | boolean | null | undefined;
}

function stableStringify(fields: HashableFields): string {
  const keys = Object.keys(fields).sort();
  return JSON.stringify(keys.map((k) => [k, fields[k] ?? null]));
}

function evidenceHash(fields: HashableFields): string {
  const bytes = new TextEncoder().encode(stableStringify(fields));
  const digest = keccak_256(bytes);
  return '0x' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function depositReceipt(rec: DepositRecord) {
  const terms: HashableFields = {
    kind: 'deposit',
    depositId: rec.depositId,
    chain: rec.chain,
    chainId: rec.chainId,
    fromAssetId: rec.fromAssetId,
    toAssetId: rec.toAssetId,
    sendAmount: rec.sendAmount,
    minReceiveAmount: rec.minReceiveAmount,
    destinationAddress: rec.destinationAddress.toLowerCase(),
    depositAddress: rec.depositAddress.toLowerCase(),
    factoryAddress: rec.factoryAddress.toLowerCase(),
    logicAddress: rec.logicAddress.toLowerCase(),
    salt: rec.salt ?? null,
    feeBps: rec.fee.bps,
    feeRecipient: rec.fee.recipient.toLowerCase(),
    aggregator: rec.aggregator,
    rateType: rec.rateType ?? 'float',
    // v0.4 target lock: the execution CONDITION is itself evidence — pinned
    // into the digest, so "only execute if route ≥ target" is provable
    // after the fact, not just the outcome.
    lockKind: rec.lockKind ?? 'rate',
    targetMinReceive: rec.targetMinReceive ?? null,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    simulated: Boolean(rec.simulated),
  };

  return {
    schema: 'ee.io/receipt-v1',
    exportedAt: Date.now(),
    evidenceHash: evidenceHash(terms),
    terms,
    state: {
      status: rec.status,
      fundedAt: rec.fundedAt ?? null,
      txHash: rec.txHash ?? null,
      outTxHash: rec.outTxHash ?? null,
      receiveAmount: rec.receiveAmount,
      partnerId: rec.partnerId ?? null,
      // Volatile market observation for target locks (excluded from digest).
      lastObservedOut: rec.lastObservedOut ?? null,
      observedAt: rec.observedAt ?? null,
    },
    verification: [
      'Recompute: keccak256(stable-json of terms sorted by key) === evidenceHash',
      `CREATE2 check: address(keccak256(0xff ++ factory ++ salt ++ hash(minimalProxy(logic)))) == ${rec.depositAddress}`,
      `On-chain terms bound in salt abi.encode(depositId, destination, fromToken, toToken)`,
    ] as string[],
  };
}

export function orderReceipt(rec: OrderRecord) {
  const plan = rec.plan;
  const terms: HashableFields = {
    kind: 'order',
    orderId: rec.orderId,
    planId: plan.planId,
    aggregator: plan.aggregator,
    fromAssetId: plan.fromAssetId,
    toAssetId: plan.toAssetId,
    sendAmount: plan.sendAmount,
    minReceiveAmount: plan.minReceiveAmount,
    destinationAddress: plan.destinationAddress.toLowerCase(),
    depositAddress:
      plan.transaction.kind === 'deposit' ? plan.transaction.depositAddress.toLowerCase() : null,
    feeBps: plan.fee.bps,
    feeRecipient: plan.fee.recipient.toLowerCase(),
    rateType: plan.rateType,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
  };

  return {
    schema: 'ee.io/receipt-v1',
    exportedAt: Date.now(),
    evidenceHash: evidenceHash(terms),
    terms,
    state: {
      status: rec.status,
      inboundTxHash: rec.inboundTxHash ?? null,
      outboundTxHash: rec.outboundTxHash ?? null,
      confirmations: rec.confirmations,
      partnerId: rec.partnerId ?? null,
    },
    verification: [
      'Recompute: keccak256(stable-json of terms sorted by key) === evidenceHash',
    ] as string[],
  };
}
