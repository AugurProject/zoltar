import Inv48Minimum
import Inv32Division
namespace Inv48.Positive
open Inv32Division

def roundedRep (rep price : Nat) := Inv03.ceilQuot (rep * 10^18) price

/-- The actual rounded multiplication fits iff its cross-multiplied budget does.
No price floor is assumed: every positive uint256 price is covered. -/
theorem rounded_fits_iff (rep price : Nat) (positive : 0 < price) :
    roundedRep rep price < R ↔ rep * 10^18 ≤ (R-1) * price := by
  have eq := Inv03.ceil_le (rep * 10^18) price (R-1) positive
  have rpositive : 0 < R := by decide
  unfold roundedRep
  omega

theorem result_fits (collateral rep price : Nat) (positive : 0 < price)
    (collateralFits : collateral < R) (budget : rep * 10^18 ≤ (R-1) * price) :
    Inv48.minimum collateral rep price < R := by
  exact max_lt collateralFits ((rounded_fits_iff rep price positive).mpr budget)

theorem formula_sufficient (collateral rep price amount : Nat) (positive : 0 < price) :
    max collateral (roundedRep rep price) ≤ amount ↔
      collateral ≤ amount ∧ rep * 10^18 ≤ amount * price :=
  Inv48.sufficient collateral rep price amount positive

theorem formula_antitone (collateral rep price nextPrice : Nat) (positive : 0 < price)
    (rise : price ≤ nextPrice) :
    max collateral (roundedRep rep nextPrice) ≤ max collateral (roundedRep rep price) :=
  Inv48.monotonePrice collateral rep price nextPrice positive rise

/-- Once the rounded arithmetic fits, increasing the positive price preserves fit. -/
theorem budget_antitone (rep price nextPrice : Nat) (rise : price ≤ nextPrice)
    (budget : rep * 10^18 ≤ (R-1) * price) :
    rep * 10^18 ≤ (R-1) * nextPrice :=
  budget.trans (Nat.mul_le_mul_left _ rise)

#print axioms rounded_fits_iff
#print axioms result_fits
#print axioms formula_sufficient
#print axioms formula_antitone
#print axioms budget_antitone
end Inv48.Positive
