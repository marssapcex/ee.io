/**
 * evidence/types.ts — Fulfilment-evidence receipt schema (v1 PoC).
 *
 * Binds the three legs of an agent-commerce transaction into one
 * tamper-evident receipt:
 *   1) payment  — the x402 settlement leg (proved the buyer paid)
 *   2) delivery — hash commitment to the artifact the seller returned
 *                 (proved something specific was delivered)
 *   3) verdict  — a validator score in the ERC-8004 Validation
 *                 registry's domain (0..100)
 *
 * Failure modes targeted (from the empirical study arXiv:2606.26028):
 *   C3/C4: feedback must be grounded in a *real* interaction and be
 *          expensive to fake -> `payment.verified` gates feedback emission.
 *   C1:    commensurable scoring -> verdict is fixed to 0..100, tag1 fixed.
 *   C2:    outlier-robust aggregation -> see erc8004.ts robustSummary().
 */

export type Hex = `0x${string}`;

export type ValidationMethod =
  | 'hash-commit' // seller committed artifact hash; cheapest tier
  | 'reexec'      // stake-secured re-execution (validator network)
  | 'tee'         // TEE oracle attestation
  | 'zkml';       // zkML proof (future tier; flagged as not-yet-practical)

export interface PaymentLeg {
  scheme: 'exact' | 'upto'; // x402 payment schemes
  chainId: number;          // eip155 chain id of settlement
  txHash: Hex;              // x402 settlement transaction
  from: Hex;                // buyer / agent wallet
  to: Hex;                  // seller wallet
  asset: string;            // settlement asset (e.g. USDC address)
  amount: string;           // atomic units, decimal string
  facilitator: string;      // facilitator that performed verify/settle
  verified: boolean;        // TRUE only after cross-check vs chain/facilitator
}

export interface DeliveryLeg {
  artifactHash: Hex;   // keccak256(artifact bytes) — the response/file
  artifactURI: string; // ipfs:// or https:// pointer to the artifact
  method: ValidationMethod;
  deliveredAt: number; // unix seconds
}

export interface VerdictLeg {
  score: number; // integer 0..100 (ERC-8004 validationResponse domain)
  validator: Hex; // validator address that signed the verdict
  ref?: Hex;      // Validation Registry requestHash once it ships
}

export interface ReceiptCore {
  v: 1;
  agentId: string; // "{namespace}:{chainId}:{identityRegistry}:{agentId}"
  taskId: string;  // buyer-generated task correlation id
  payment: PaymentLeg;
  delivery: DeliveryLeg;
  verdict: VerdictLeg;
  ts: number; // receipt creation time (unix seconds)
}

export interface EvidenceReceipt extends ReceiptCore {
  prevHash: Hex;    // link into the append-only per-agent chain
  receiptHash: Hex; // keccak256( coreHash ‖ prevHash )
}
