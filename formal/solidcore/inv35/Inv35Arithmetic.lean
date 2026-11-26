import Inv32RatioLoop

namespace Inv35Arithmetic
open Inv32RatioLoop (answer)

private theorem floorSum (p q d : Nat) (pos : 0 < d) (total : p+q = 10000*d) :
    (p/d + q/d = 9999 ∨ p/d + q/d = 10000) ∧ (p/d + q/d = 10000 ↔ d ∣ p) := by
  have price := Nat.div_add_mod p d
  have mirror := Nat.div_add_mod q d
  have rp := Nat.mod_lt p pos
  have rq := Nat.mod_lt q pos
  have eqn : d * (p/d + q/d) + (p%d + q%d) = d * 10000 := by
    rw [Nat.mul_add, Nat.mul_comm d 10000, ← total]; omega
  have upper : p/d + q/d ≤ 10000 := Nat.le_of_mul_le_mul_left (by omega) pos
  have lower : 9999 ≤ p/d + q/d := by
    by_contra! h
    have h' := Nat.mul_le_mul_left d (show p/d+q/d+2 ≤ 10000 by omega)
    rw [Nat.mul_add,Nat.mul_two] at h'
    omega
  constructor
  · omega
  · rw [Nat.dvd_iff_mod_eq_zero]
    constructor
    · intro full; rw [full] at eqn; omega
    · intro exactPrice
      by_contra! h
      have step : p/d+q/d+1 = 10000 := by omega
      have scaled := congrArg (d * ·) step
      dsimp only at scaled
      rw [Nat.mul_add,Nat.mul_one] at scaled
      omega

theorem complement (x y : Nat) (pos : 0 < x+y) :
    let a := answer 10000 y x
    let b := answer 10000 x y
    (a+b = 9999 ∨ a+b = 10000) ∧ (a+b = 10000 ↔ (x+y) ∣ 10000*y) := by
  dsimp [answer]
  rw [Nat.add_comm y x]
  apply floorSum _ _ _ pos
  rw [Nat.mul_add,Nat.add_comm]

theorem scale (x y k : Nat) (hk : 0 < k) :
    answer 10000 (k*y) (k*x) = answer 10000 y x := by
  unfold answer
  rw [← Nat.mul_add, Nat.mul_left_comm, Nat.mul_div_mul_left _ _ hk]
end Inv35Arithmetic
