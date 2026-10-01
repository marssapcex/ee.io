import { describe, expect, it } from 'vitest';
import { GENESIS, hashCore, makeReceipt, stableStringify } from '../evidence/keccakChain.js';
import {
  auditReceipt,
  verifyChain,
  verifyDeliveryLeg,
  verifyPaymentLeg,
  type PaymentProvider,
  type PaymentSnapshot,
} from '../evidence/verify.js';
import { robustSummary, toErc8004Feedback } from '../evidence/erc8004.js';
import type { ReceiptCore } from '../evidence/types.js';
import { keccakHex } from '../evidence/keccakChain.js';

const HEX = (ch: string) => `0x${ch.repeat(64)}` as const;

function coreOf(n: number, opts?: { verified?: boolean; score?: number }): ReceiptCore {
  return {
    v: 1,
    agentId: 'eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:22',
    taskId: `task-${n}`,
    payment: {
      scheme: 'exact',
      chainId: 8453,
      txHash: HEX('a'),
      from: '0xB0b0000000000000000000000000000000000001',
      to: '0x5e11eR0000000000000000000000000000000002',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: String(1000 + n),
      facilitator: 'facilitator.coinbase.example',
      verified: opts?.verified ?? true,
    },
    delivery: {
      artifactHash: keccakHex(new TextEncoder().encode(`artifact-${n}`)),
      artifactURI: `ipfs://bafy-artifact-${n}`,
      method: 'hash-commit',
      deliveredAt: 1_790_000_000 + n,
    },
    verdict: {
      score: opts?.score ?? 100,
      validator: '0xVa11dA7000000000000000000000000000000003',
    },
    ts: 1_790_000_100 + n,
  };
}

function snapFor(core: ReceiptCore, extra?: Partial<PaymentSnapshot>): PaymentSnapshot {
  return {
    chainId: core.payment.chainId,
    txHash: core.payment.txHash,
    from: core.payment.from,
    to: core.payment.to,
    asset: core.payment.asset,
    amount: core.payment.amount,
    settled: true,
    ...extra,
  };
}

const providerOf = (snap: PaymentSnapshot | null): PaymentProvider => ({
  fetchPayment: async () => snap,
});

describe('evidence: canonical encoding', () => {
  it('stableStringify is key-order independent, so hashes are portable', () => {
    const a = stableStringify({ b: 1, a: { d: 2, c: 3 } });
    const b = stableStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it('receipt hash is deterministic and chained to prev', () => {
    const r1 = makeReceipt(coreOf(1));
    const r2 = makeReceipt(coreOf(2), r1.receiptHash);
    expect(r1.prevHash).toBe(GENESIS);
    expect(r2.prevHash).toBe(r1.receiptHash);
    expect(r2.receiptHash).not.toBe(r1.receiptHash);
    const again = makeReceipt(coreOf(1));
    expect(again.receiptHash).toBe(r1.receiptHash);
  });
});

describe('evidence: chain audit (append-only integrity)', () => {
  it('accepts a valid chain', () => {
    const chain = [makeReceipt(coreOf(1))];
    chain.push(makeReceipt(coreOf(2), chain[0].receiptHash));
    chain.push(makeReceipt(coreOf(3), chain[1].receiptHash));
    expect(verifyChain(chain)).toEqual({ ok: true, checked: 3 });
  });

  it('flag a tampered verdict score at the exact index', () => {
    const chain = [makeReceipt(coreOf(1)), makeReceipt(coreOf(2))];
    chain[1].prevHash = chain[0].receiptHash;
    const tampered = { ...chain[1], verdict: { ...chain[1].verdict, score: 5 } };
    const verdict = verifyChain([chain[0], tampered]);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAt).toBe(1);
    expect(verdict.reason).toContain('hash');
  });

  it('flag a spliced/dropped link', () => {
    const chain = [makeReceipt(coreOf(1))];
    const orphan = makeReceipt(coreOf(9)); // genesis-linked, not chained to r1
    const verdict = verifyChain([chain[0], orphan]);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAt).toBe(1);
    expect(verdict.reason).toContain('link');
  });
});

describe('evidence: payment grounding (C3/C4 — the Sybil gate)', () => {
  it('verifies a payment leg against a provider snapshot', async () => {
    const core = coreOf(1);
    const res = await verifyPaymentLeg(core.payment, providerOf(snapFor(core)));
    expect(res.ok).toBe(true);
    expect(res.mismatches).toEqual([]);
  });

  it('rejects amount drift', async () => {
    const core = coreOf(1);
    const res = await verifyPaymentLeg(core.payment, providerOf(snapFor(core, { amount: '1' })));
    expect(res.ok).toBe(false);
    expect(res.mismatches).toContain('amount');
  });

  it('rejects unsettled or missing payments', async () => {
    const core = coreOf(1);
    expect((await verifyPaymentLeg(core.payment, providerOf(null))).mismatches).toContain(
      'payment not found',
    );
    expect(
      (await verifyPaymentLeg(core.payment, providerOf(snapFor(core, { settled: false })))).mismatches,
    ).toContain('not settled');
  });
});

describe('evidence: delivery commitment', () => {
  it('passes when bytes match the committed hash and fails otherwise', () => {
    const core = coreOf(7);
    const good = verifyDeliveryLeg(core.delivery, new TextEncoder().encode('artifact-7'));
    expect(good.ok).toBe(true);
    const bad = verifyDeliveryLeg(core.delivery, new TextEncoder().encode('artifact-8'));
    expect(bad.ok).toBe(false);
  });
});

describe('evidence: ERC-8004 emission rules', () => {
  it('REFUSES feedback without verified payment (the grounding rule)', () => {
    const r = makeReceipt(coreOf(1, { verified: false }));
    expect(() => toErc8004Feedback(r, 'ipfs://receipt-1')).toThrow(/grounding/);
  });

  it('emits spec-shaped, payment-anchored feedback', () => {
    const r = makeReceipt(coreOf(1));
    const fb = toErc8004Feedback(r, 'ipfs://receipt-1');
    expect(fb.tag1).toBe('fulfilled');
    expect(fb.value).toBe(100);
    expect(fb.valueDecimals).toBe(0);
    expect(fb.feedbackHash).toBe(r.receiptHash);
    expect(fb.proofOfPayment).toEqual({
      fromAddress: r.payment.from,
      toAddress: r.payment.to,
      chainId: r.payment.chainId,
      txHash: r.payment.txHash,
    });
  });

  it('rejects out-of-domain scores (commensurable scale)', () => {
    const r = makeReceipt(coreOf(1, { score: 101 }));
    expect(() => toErc8004Feedback(r, 'ipfs://x')).toThrow(/0..100/);
  });
});

describe('evidence: outlier-robust aggregation (C2)', () => {
  it('median/trimmed mean resist a single sybil zero the mean cannot', () => {
    const honest = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
    const attacked = [...honest, 0];
    const mean = attacked.reduce((s, x) => s + x, 0) / attacked.length;
    expect(mean).toBeLessThan(92); // mean collapses
    const s = robustSummary(attacked);
    expect(s.median).toBe(100); // median stands
    expect(s.trimmedMean10).toBeGreaterThanOrEqual(100); // trimmed mean stands
  });

  it('handles empty input', () => {
    expect(robustSummary([])).toEqual({ count: 0, median: null, trimmedMean10: null });
  });
});

describe('evidence: one-call audit', () => {
  it('audits payment + delivery together', async () => {
    const core = coreOf(42);
    const r = makeReceipt(core);
    const res = await auditReceipt(r, providerOf(snapFor(core)), new TextEncoder().encode('artifact-42'));
    expect(res.ok).toBe(true);
    expect(hashCore(core)).toBeDefined();
  });
});
