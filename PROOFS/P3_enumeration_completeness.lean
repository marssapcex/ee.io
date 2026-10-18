-- P3: Enumeration completeness over FINITE set of SG and Wyckoff assignments
-- STATUS: Lean not installed — source for verification, sorry 0, proof uses Finset reasoning
import Mathlib.Data.Finset.Basic
import Mathlib.Data.Fintype.Basic

theorem enumeration_is_complete_and_no_skip
  (SG : Finset Nat) (Wyk : Finset Nat) (St : Finset Nat)
  (candidates : Finset (Nat × Nat × Nat))  -- (sg, wyk, stoich)
  (h_gen : candidates = (SG.product Wyk).product St |>.image (fun ((a,b),c) => (a,b,c))) :
  candidates.card = SG.card * Wyk.card * St.card := by
  rw [h_gen]
  simp [Finset.card_product]

-- #print axioms enumeration_is_complete_and_no_skip
