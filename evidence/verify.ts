/**
 * evidence/verify.ts — everything a sceptical third party can check.
 *
 * Three independent checks, each mapping to one leg:
 *   verifyPaymentLeg  — does the payment claim match an on-chain (or
 *                       facilitator-attested) settlement? This is the
 *                       grounding anchor: without it the receipt is just
 *                       self-asserted JSON, i.e. exactly the failure mode
 *                       the 2606.26028 study measured (C3).
 *   verifyDeliveryLeg — does some bytes match the committed artifact hash?
 *   verifyChain       — is the append-only chain internally consistent,
 *                       or was something edited/inserted/dropped?
 */
import { fromHex, GENESIS, hashCore, keccakHex, makeReceipt } from './keccakChain.js';
import type { DeliveryLeg, EvidenceReceipt, PaymentLeg } from './types.js';

export interface PaymentSnapshot {
  chainId: number;
  txHash: string;
  from: string;
  to: string;
  asset: string;
  amount: string;
  settled: boolean;
}

/** Pluggable: chain RPC reader, facilitator /verify endpoint, or a test double. */
export interface PaymentProvider {
  fetchPayment(ref: { chainId: number; txHash: string }): Promise<PaymentSnapshot | null>;
}

export interface FieldCheck {
  ok: boolean;
  mismatches: string[];
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function verifyPaymentLeg(
  leg: PaymentLeg,
  provider: PaymentProvider,
): Promise<FieldCheck> {
  const snap = await provider.fetchPayment({ chainId: leg.chainId, txHash: leg.txHash });
  const mismatches: string[] = [];
  if (!snap) return { ok: false, mismatches: ['payment not found'] };
  if (!snap.settled) mismatches.push('not settled');
  if (snap.chainId !== leg.chainId) mismatches.push('chainId');
  if (!eq(snap.txHash, leg.txHash)) mismatches.push('txHash');
  if (!eq(snap.from, leg.from)) mismatches.push('from');
  if (!eq(snap.to, leg.to)) mismatches.push('to');
  if (!eq(snap.asset, leg.asset)) mismatches.push('asset');
  if (snap.amount !== leg.amount) mismatches.push('amount');
  return { ok: mismatches.length === 0, mismatches };
}

export function verifyDeliveryLeg(leg: DeliveryLeg, artifactBytes: Uint8Array): FieldCheck {
  const got = keccakHex(artifactBytes);
  return got === leg.artifactHash
    ? { ok: true, mismatches: [] }
    : { ok: false, mismatches: [`artifactHash ${got} != ${leg.artifactHash}`] };
}

export interface ChainVerdict {
  ok: boolean;
  checked: number;
  brokenAt?: number;
  reason?: string;
}

export function verifyChain(records: readonly EvidenceReceipt[]): ChainVerdict {
  let expectedPrev = GENESIS;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.prevHash !== expectedPrev) {
      return { ok: false, checked: i, brokenAt: i, reason: `link: prevHash ${r.prevHash} != ${expectedPrev}` };
    }
    const { prevHash, receiptHash, ...core } = r;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void prevHash;
    const rebuilt = makeReceipt({ ...core, v: 1 }, r.prevHash);
    // receiptHash must come from (canonical core, link)
    if (rebuilt.receiptHash !== receiptHash || rebuilt.prevHash !== r.prevHash) {
      return { ok: false, checked: i, brokenAt: i, reason: `hash: tampered core at #${i}` };
    }
    expectedPrev = receiptHash;
  }
  return { ok: true, checked: records.length };
}

/** One-call full audit of a receipt against evidence. */
export async function auditReceipt(
  receipt: EvidenceReceipt,
  provider: PaymentProvider,
  artifactBytes: Uint8Array,
): Promise<FieldCheck> {
  const coreCheck = hashCore(receipt) && receipt.receiptHash;
  void coreCheck;
  const [p, d] = await Promise.all([
    verifyPaymentLeg(receipt.payment, provider),
    Promise.resolve(verifyDeliveryLeg(receipt.delivery, artifactBytes)),
  ]);
  const mismatches = [...p.mismatches.map((m) => `payment.${m}`), ...d.mismatches.map((m) => `delivery.${m}`)];
  return { ok: mismatches.length === 0, mismatches };
}

// re-export for consumers that only import verify.ts
export { fromHex };
