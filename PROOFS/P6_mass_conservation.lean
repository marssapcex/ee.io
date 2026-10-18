-- P6: Mass / stoichiometry conservation
import Mathlib.Data.Real.Basic

theorem stoichiometry_mass_conserved
  (n_api n_cof n_cc Z : ℝ) (hZ : Z ≠ 0) (h : n_api + n_cof = n_cc * Z) :
  n_cc = (n_api + n_cof) / Z := by
  field_simp at h ⊢
  linarith

-- #print axioms stoichiometry_mass_conserved
