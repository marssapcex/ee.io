-- P1: Existence of a global minimum of lattice-energy functional on compact feasible set
-- STATUS: Lean binary NOT INSTALLED this run (ENV_REPORT.md -> FAIL). Source provided for verification; sorry count = 0 by inspection.
-- To compile: lake build (Lean 4.7.0 + Mathlib 4.7.0)
import Mathlib.Topology.Compactness.Compact
import Mathlib.Analysis.Calculus.ContDiff.Basic

-- Model: lattice energy is continuous on compact set of lattice parameters (bounded cell + positions)
-- Under coercivity (energy -> ∞ as density -> 0 or ∞), Weierstrass theorem gives existence.

theorem lattice_energy_has_min_on_compact
  {E : Type} [MetricSpace E]
  {K : Set E} (hK_compact : IsCompact K) (hK_nonempty : K.Nonempty)
  {f : E → ℝ} (hf_cont : ContinuousOn f K) :
  ∃ x ∈ K, ∀ y ∈ K, f x ≤ f y := by
  -- By extreme value theorem for compact sets in metric spaces
  obtain ⟨x, hx_mem, hx_min⟩ := IsCompact.exists_isMinOn hK_compact hK_nonempty hf_cont
  exact ⟨x, hx_mem, hx_min⟩

-- No sorry, no custom axiom
-- #print axioms lattice_energy_has_min_on_compact -- would show [propext, funext, choice] from Mathlib
