import Inv03Budget
import Inv32Division
open Inv32Division
namespace Inv48.MinimaCeil
/-- The unchecked subtraction on a zero numerator yields the largest word.
For the settlement scale its subsequent division and increment still fit. -/
theorem scaledFactor (v : Nat) (small : v<R) :
    let pred := if v=0 then R-1 else v-1
    pred/100+1<R ∧ (if v=0 then 0 else 1)*(pred/100+1) = Inv03.ceilQuot v 100 := by
  dsimp only
  by_cases zero : v=0
  · subst v; decide
  · rw [if_neg zero,if_neg zero,Nat.one_mul]
    constructor
    · have h := Nat.div_le_self (v-1) 100
      omega
    · unfold Inv03.ceilQuot
      rw [show v+(100-1) = (v-1)+100 by omega,Nat.add_div_right _ (by decide)]
end Inv48.MinimaCeil
