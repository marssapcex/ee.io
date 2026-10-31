# Lens: accounting desync (share ≠ asset, reserve ≠ balance)

The most expensive class, and the one where the corpus pattern matters most: the *shape* recurs
(shares minted from a computed price), only the arithmetic differs.

Ask:

- What is the exchange rate, exactly? Write it as one expression. Which terms can be changed by an
  unprivileged caller? Which terms are *not* bounded by anything contractual?
- Is there a quantity that grows with **notional** but is capped in one place and uncapped in another?
  (A payout clamped to collateral while the accounting term is linear in notional is a real, common
  shape.)
- `totalAssets()` from `balanceOf(this)` → donation attack; from a cached storage var → stale;
  from an oracle → manipulation.
- Rounding on mint vs redeem: does the protocol round both in its own favour? Who can loop the dust?
- Does any function read `liquidityPool`/`reserve` and then act on it without re-reading after a
  transfer?
- Fee-on-transfer and rebasing tokens: does the code assume `amount == received`?

Corpus: `corpus/classes/business-logic.md`, `donation-inflation.md`, `integer-precision.md`.
Read `2023__2023-11-22_KyberSwap_TickMathBug_Multi.json` as the reference composition
(rounding → uncrossed state → double count → drain), and
`2023__2023-03-13_EulerFinance_DonateToReserves_ETH.json` for the donate-shape.
