# Judging: FINDING vs LEAD, severity, false positives

## The four questions, in order

1. **Who pays?** Name the account whose balance decreases and the token. If you cannot, stop.
2. **Who can do it?** An unprivileged EOA. If any step needs owner/guardian/relayer/whitelist, it is
   not permissionless — say so and file it as LEAD with `why_unproven: privileged`.
3. **Is the money recoverable by the attacker?** Profit must survive fees, slippage, and the exit.
   A drain into a paused token is not a drain.
4. **Does the protocol still have a choice?** If a single admin transaction (pause, sweep, upgrade)
   stops it, the finding is real but the risk is conditional — report the condition and the block
   budget, do not inflate the severity.

## Severity

| severity | test |
|---|---|
| critical | unprivileged, direct loss of other users' funds, no preconditions beyond having gas |
| high | unprivileged loss, but needs a state the protocol rarely reaches, or the loss is capped below the pool |
| medium | loss requires a privileged action, or griefing with real cost to users, or accounting corruption without an exit |
| (not reported) | self-harm, admin rug without mechanism, MEV, dust rounding |

Latent-but-real is *critical severity with a `blocked_by` field*, not "informational". The difference
between a live bug and a paused one is one function call by the owner, and a report that hides that is
misleading in the other direction.

## False-positive killers

Run these before you write `FINDING`:

- **Unit check.** Convert both sides to the same decimals on paper. Half of "the rate is wrong" is a
  1e6/1e18 mismatch in the analysis, not the code.
- **Rounding direction.** Which way does each division round, and does the protocol keep the dust?
- **Access check.** Read the modifier chain to the root, including inherited `onlyOwner` and the
  router's per-selector dispatch.
- **Pause check.** Is the entry point actually routed? `IPOR_012`-style dispatch misses look exactly
  like reverts from a guard.
- **Reachability.** Is the state you need reachable without the collusion of two roles?
- **Profit sign.** Write the attacker's P&L as an expression, including collateral at risk. A "bug"
  that costs the attacker more than it takes is not a bug.
- **The honest reader.** Would a protocol engineer reading only your `path:` and `proof:` agree the
  money leaves? If they would need your narration, the proof is weak.

## What upgrades a LEAD to a FINDING

Exactly one thing: a run. `forge test` printing `Suite result: ok` with the balance delta in the log.
Not a compile, not a simulation in your head, not "it follows from line 88".
