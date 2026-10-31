# Lens: precision, overflow, units

- Every division: which way does it round, and who keeps the remainder? Two divisions in a row can
  turn a 1 wei error into a 1e12 error.
- Share math with a small supply: first depositor, `1 wei` mint, `MINIMUM_LIQUIDITY` present?
- `unchecked` blocks: state the bound that makes them safe, or it is a finding.
- Signed/unsigned crossings: `.toInt256()` on a value up to `type(int256).max`, subtraction underflow,
  `abs()` of `type(int256).min`.
- Units at boundaries: asset decimals vs wad vs bps vs pct. Write the conversion chain for one number
  end-to-end; a mismatch shows up as a 1e12 error and looks like "the rate is wrong".
- Overflow in curve formulas with `x*y` before division (bonding curves, spot price quotes).

Corpus: `corpus/classes/integer-precision.md`; `2026__2026-01-08_Truebit_BondingCurveOverflow.json`
and `2026__2026-01-10_FutureSwap_UnitMismatch.json` are the two cleanest "one line wrong" cases.
