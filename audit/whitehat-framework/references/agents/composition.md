# Lens: composition (the one that actually pays)

Every incident in the corpus is a *sequence*. The classes above find primitives; this lens asks
whether 3–5 primitives line up on this protocol.

Method — build the chain explicitly, and check each arrow:

```
step 1  <primitive>            needs: <precondition>
  ->  step 2 <primitive>       needs: <state produced by step 1>
  ->  step 3 <primitive>       needs: ...
  ->  sink: <account whose balance decreases>
```

Rules:

1. Every step is boring on its own; if a step is already a FINDING alone, you are done.
2. Each `needs:` must be producible by the attacker, in one transaction or across blocks — say which.
3. Reversibility: steps that must be undone (repay a flash loan) constrain the ordering.
4. Write the attacker's P&L as an expression with a sign. If it is negative at every plausible size,
   the chain is dead — say so and move on.
5. The corpus's `steps` array for the closest incident is the template for the ordering, not for the
   code. Read it, then re-derive the ordering for *this* protocol.

Reference compositions in the corpus: KyberSwap tick math (rounding → uncrossed tick → double count →
drain), Euler (donation → self-liquidation → bad debt), Nomad (init → trusted root → replay),
Indexed (spot skew → cheap mint → redeem).
