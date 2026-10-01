# evidence/ — payment-grounded fulfilment receipts (PoC, v1)

Core primitive of the agent-commerce fulfilment-evidence layer. One
`EvidenceReceipt` binds a real transaction's three legs:

```
payment (x402 settlement tx)  ─┐
delivery (artifact hash)       ├─► receiptHash = keccak256( coreHash ‖ prevHash )
verdict (validator score 0–100)─┘   → append-only, per-agent chain
```

## Why (measured, not asserted)

The ERC-8004 Reputation Registry, as deployed, fails as a trust signal
(arXiv:2606.26028, crawl of ETH/BSC/Base → 13/5/2026): 59–91% of reviewers
show coordinated Sybil funding patterns; after removal most rated agents
have **no valid feedback left**. The spec itself defers the fix
("we expect reputation systems around reviewers to emerge").

This module implements that fix as enforceable code:

| Failure mode (paper's labels) | Implemented countermeasure | Where |
|---|---|---|
| C3 — feedback not grounded in real interaction | `toErc8004Feedback()` **throws** unless `payment.verified` | `erc8004.ts` |
| C4 — manipulation is cheap | grounding requires a real settled tx (cost curve, not free posts) | `verify.ts` |
| C1 — values not commensurable | score fixed to integer 0–100, `tag1='fulfilled'`, decimals 0 | `erc8004.ts` |
| C2 — mean aggregator breaks on outliers | `robustSummary()` = median + 10% trimmed mean | `erc8004.ts` |
| tampered / spliced history | hash-chain: recompute every link or fail at exact index | `keccakChain.ts`, `verify.ts` |

## Audit a receipt without trusting us

1. Recompute `coreHash = keccak256(stableJSON(core))` — key order is
   canonicalized, so hashes are portable across implementations.
2. Recompute `receiptHash = keccak256(coreHash ‖ prevHash)` and walk the chain.
3. Cross-check the payment leg against any chain RPC or facilitator
   `/verify` endpoint (pluggable `PaymentProvider` interface).
4. Re-hash the delivered artifact bytes against `delivery.artifactHash`.

`stableStringify` + `shared/keccak.ts` are dependency-free by design — the
re-encoding survives library rot, which matters for long-lived evidence.

## Not built yet (explicit, don't assume)

- **Validator network / economics** — reexec/TEE verdicts are typed but the
  network, staking and slashing are out of scope (mirrors ERC-8004's own
  scoping decision; protocol design is the next round).
- **Chain RPC + facilitator providers** — `PaymentProvider` interface is
  defined; only test doubles exist so far.
- **On-chain anchoring** — hash-chain is self-consistent; publishing
  periodic Merkle roots onchain is planned, not implemented.
- **IPFS pinning / serving layer** for `feedbackURI`.
- **zkML verdicts** — typed, flagged not-yet-practical (state of the art:
  proofs over ~124M-param models only; no fully verifiable pipeline exists).

## Run

```bash
npx vitest run tests/evidence.test.ts   # 15 tests
npm run demo:evidence                   # end-to-end synthetic walkthrough
```
