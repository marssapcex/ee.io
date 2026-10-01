/**
 * evidence/erc8004.ts — emit ERC-8004 Reputation feedback that is
 * GROUNDED, by construction, in the receipt.
 *
 * The spec's feedback file already reserves a proofOfPayment object
 * {fromAddress, toAddress, chainId, txHash} — but nothing enforces it,
 * and the field study (arXiv:2606.26028) measured the result:
 * 59–91% of reviewers show coordinated Sybil funding patterns.
 *
 * Rules hard-coded here:
 *   - refuse to emit feedback unless receipt.payment.verified === true
 *     (C3: grounding in a real interaction; C4: fakes now cost a real
 *     settlement tx, not zero)
 *   - feedbackHash = receiptHash, so the off-chain file IS the receipt
 *     (integrity guaranteed by the hash chain)
 *   - value fixed to the verdict's 0..100 with valueDecimals = 0 and
 *     tag1 = 'fulfilled' (C1: commensurable scale everyone can consume)
 *   - aggregation helper implements outlier-robust statistics
 *     (C2: plain mean has breakdown point 0; median/trimmed-mean don't)
 */
import type { EvidenceReceipt } from './types.js';

export interface Erc8004Feedback {
  agentId: string;
  value: number;        // fixed-point domain: 0..100
  valueDecimals: 0;
  tag1: 'fulfilled';
  tag2: string;         // validation method
  endpoint: string;     // artifact URI (what was delivered)
  feedbackURI: string;  // where the receipt JSON is published
  feedbackHash: string; // receiptHash — binds file to chain
  proofOfPayment: {
    fromAddress: string;
    toAddress: string;
    chainId: number;
    txHash: string;
  };
}

export function toErc8004Feedback(receipt: EvidenceReceipt, feedbackURI: string): Erc8004Feedback {
  if (!receipt.payment.verified) {
    throw new Error(
      'grounding violation: refusing to emit ERC-8004 feedback without a verified payment leg ' +
        '(this gate is what makes reputation expensive to fake)',
    );
  }
  if (!Number.isInteger(receipt.verdict.score) || receipt.verdict.score < 0 || receipt.verdict.score > 100) {
    throw new Error(`verdict score must be integer 0..100, got ${receipt.verdict.score}`);
  }
  return {
    agentId: receipt.agentId,
    value: receipt.verdict.score,
    valueDecimals: 0,
    tag1: 'fulfilled',
    tag2: receipt.delivery.method,
    endpoint: receipt.delivery.artifactURI,
    feedbackURI,
    feedbackHash: receipt.receiptHash,
    proofOfPayment: {
      fromAddress: receipt.payment.from,
      toAddress: receipt.payment.to,
      chainId: receipt.payment.chainId,
      txHash: receipt.payment.txHash,
    },
  };
}

export interface RobustSummary {
  count: number;
  median: number | null;
  trimmedMean10: number | null; // mean after dropping 10% from each tail
}

/** Outlier-robust aggregation for consumption off-chain (C2). */
export function robustSummary(values: readonly number[]): RobustSummary {
  const n = values.length;
  if (n === 0) return { count: 0, median: null, trimmedMean10: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const trim = Math.floor(n * 0.1);
  const kept = sorted.slice(trim, n - trim);
  const trimmedMean10 = kept.reduce((s, x) => s + x, 0) / kept.length;
  return { count: n, median, trimmedMean10 };
}
