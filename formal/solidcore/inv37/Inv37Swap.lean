import Inv33Proved

namespace Inv37Source
open Inv32
open Inv32Source

/-- A successful generated exact-input quote preserves the reserve product
when the input reserve gains the gross input and the output reserve pays the quote. -/
theorem exactInputProduct (x y gross fee out : Nat)
    (hx : x < word) (hy : y < word) (hg : gross < word) (hf : fee < word)
    (success : returnsAmount "quoteExactInput" x y gross fee out) :
    x * y ≤ (x + gross) * (y - out) := by
  obtain ⟨_, _, oy, _, bound⟩ := Inv33Source.exactInputFloorBound _ _ _ _ _ hx hy hg hf success
  let net := netInput gross fee
  change out * (x + net) ≤ y * net at bound
  have residual : y - out + out = y := Nat.sub_add_cancel (by omega)
  have scaled := congrArg (fun k => k * net) residual
  have inputScaled := congrArg (fun k => x * k) residual
  have retained := Nat.mul_le_mul_right (y-out) (Inv32ForwardSteps.netBound gross fee)
  change net * (y-out) ≤ gross * (y-out) at retained
  simp only [Nat.mul_add, Nat.add_mul] at bound scaled inputScaled ⊢
  rw [Nat.mul_comm out x] at bound
  rw [Nat.mul_comm (y-out) net] at scaled
  omega

theorem exactOutputProduct (x y target fee gross : Nat)
    (hx : x < word) (hy : y < word) (ht : target < word) (hg : gross < word) (hf : fee < word)
    (success : returnsAmount "quoteExactOutput" x y target fee gross) :
    x * y ≤ (x + gross) * (y - target) := by
  obtain ⟨out, h, enough⟩ := (minimumGrossInput _ _ _ _ _ _ hx hy ht hf hg success).mp (Nat.le_refl gross)
  exact Nat.le_trans (exactInputProduct _ _ _ _ _ hx hy hg hf h)
    (Nat.mul_le_mul_left _ (Nat.sub_le_sub_left enough _))

end Inv37Source
