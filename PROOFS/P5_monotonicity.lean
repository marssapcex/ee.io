-- P5: Ordering/monotonicity — if A below B by > method spread, ranking stable under error model
import Mathlib.Data.Real.Basic

theorem ranking_stable_if_gap_exceeds_spread
  (E_A E_B σ : ℝ) (hσ_pos : σ > 0) (h_gap : E_A + 2*σ < E_B) :
  E_A < E_B := by
  linarith

-- This is the formal core of the decision rule: ΔG > 2σ → stable claim
-- #print axioms ranking_stable_if_gap_exceeds_spread
