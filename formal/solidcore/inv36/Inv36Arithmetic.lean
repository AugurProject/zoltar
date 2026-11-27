import Inv35Proved

namespace Inv36Source
open Inv32Division (R)
open Inv35Source (price priceFormula)

/-- The smaller reserve is rounded down after the larger reserve is fixed. -/
def amounts (c p : Nat) : Nat × Nat :=
  if 5000 ≤ p then (c*(10000-p)/p,c) else (c,c*p/(10000-p))

theorem reflected (c p : Nat) (hp : p < 10000) :
    amounts c (10000-p) = (amounts c p).swap := by
  unfold amounts
  rw [Nat.sub_sub_self (by omega)]
  by_cases low : p < 5000
  · rw [if_pos (by omega),if_neg (by omega)]; rfl
  by_cases high : 5000 < p
  · rw [if_neg (by omega),if_pos (by omega)]; rfl
  have eq : p=5000 := by omega
  subst p
  simp

theorem displayed (c p : Nat) (hp : 0<p ∧ p<10000)
    (hx : (amounts c p).1<R) (hy : (amounts c p).2<R)
    (positive : 0<(amounts c p).1 ∧ 0<(amounts c p).2) :
    ∃ b, price (amounts c p).1 (amounts c p).2 = some b ∧
      (p ≤ 5000 → b ≤ p) ∧ (5000 ≤ p → p ≤ b) := by
  refine ⟨_,priceFormula _ _ hx hy (by omega),?_⟩
  by_cases high : 5000 ≤ p
  · simp only [amounts, high, if_true, Inv32RatioLoop.answer] at positive ⊢
    let x := c*(10000-p)/p
    have floor : x*p ≤ c*(10000-p) := Nat.div_mul_le_self _ _
    have lower : p ≤ 10000*c/(x+c) := by
      apply (Nat.le_div_iff_mul_le (by omega)).mpr
      rw [Nat.mul_add,Nat.mul_comm p x,Nat.mul_comm p c,Nat.mul_comm 10000 c]
      rw [Nat.mul_sub] at floor
      have := Nat.mul_le_mul_left c (show p ≤ 10000 by omega)
      omega
    refine ⟨?_, fun _ => lower⟩
    intro h
    have eq : p = 5000 := by omega
    subst p
    simp only [Nat.reduceSub,Nat.mul_div_cancel _ (by decide : 0<5000)]
    apply (Nat.div_le_iff_le_mul (by omega)).mpr
    omega
  · simp only [amounts, high, if_false, Inv32RatioLoop.answer] at positive ⊢
    let y := c*p/(10000-p)
    have floor : y*(10000-p) ≤ c*p := Nat.div_mul_le_self _ _
    rw [Nat.mul_sub] at floor
    have := Nat.mul_le_mul_left y (show p ≤ 10000 by omega)
    refine ⟨fun _ => ?_,fun h => (by contradiction)⟩
    change 10000*y/(c+y) ≤ p
    apply (Nat.div_le_iff_le_mul (by omega)).mpr
    rw [Nat.mul_add,Nat.mul_comm p c,Nat.mul_comm p y,Nat.mul_comm 10000 y]
    omega
end Inv36Source
