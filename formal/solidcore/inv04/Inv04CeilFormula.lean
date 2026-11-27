import Inv03Budget
import Inv32Division
open Inv32Division
namespace Inv04.Ceil
/-- The unchecked subtraction on a zero numerator yields the largest word.
For the settlement scale its subsequent division and increment still fit. -/
theorem scaledFactor (v : Nat) (small : v<R) :
    let pred := if v=0 then R-1 else v-1
    pred/(10^9)+1<R ∧ (if v=0 then 0 else 1)*(pred/(10^9)+1) = Inv03.ceilQuot v (10^9) := by
  dsimp only
  by_cases zero : v=0
  · subst v; decide
  · rw [if_neg zero,if_neg zero,Nat.one_mul]
    constructor
    · have h := Nat.div_le_self (v-1) (10^9)
      omega
    · unfold Inv03.ceilQuot
      rw [show v+(10^9-1) = (v-1)+10^9 by omega,Nat.add_div_right _ (by decide)]
end Inv04.Ceil
