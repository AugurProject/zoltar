import Inv32ProductValues
open SolidCore.Solidity.Source Inv32Division Inv32Product Inv32Scalar Inv32ProductValues
namespace Inv32High
private theorem subResult (x y : Formula) (env : Env) (a b : Nat) (ha : a < R) (hb : b < R)
    (hx : x.run false env = some a) (hy : y.run false env = some b) :
    (subF x y).run false env = some ((a+R-b)%R) := by
  simp [subF,binary,hx,hy,subWord _ _ ha hb,projectWord]

theorem highResult (env : Env) (m l : Nat) (hm : m < R) (hl : l < R)
    (readM : env "mm" = some m) (readL : env "low" = some l) :
    highExpr.run false env = some (((m+R-l)%R+R-(if m<l then 1 else 0))%R) := by
  have em := cleanup (localWord "mm") false env _ hm readM
  have el := cleanup (localWord "low") false env _ hl readL
  have d := subResult mm low env m l hm hl em el
  have dd := cleanup _ _ _ _ (Nat.mod_lt _ (Nat.two_pow_pos 256)) d
  have ddd := cleanup _ _ _ _ (Nat.mod_lt _ (Nat.two_pow_pos 256)) dd
  have cmp : (ltF mm low).run false env = some (if m<l then 1 else 0) := by
    simp [ltF,binary,em,el,ltWord _ _ hm hl,projectWord,mm,low] at *
  have carry : (choice (ltF mm low) (literal 1) (literal 0)).run false env = some (if m<l then 1 else 0) := by
    simp only [choice,cmp,Option.bind_some]
    split <;> rfl
  apply cleanup _ _ _ _ (Nat.mod_lt _ (Nat.two_pow_pos 256))
  apply subResult _ _ _ _ _ (Nat.mod_lt _ (Nat.two_pow_pos 256)) _ ddd carry
  split <;> decide
-- Recover the high limb from residues modulo w and w-1.
private theorem recover (w p : Nat) (positive : 1 < w) (bound : p ≤ (w-1)*(w-1)) :
    let low := p%w
    let mm := p%(w-1)
    ((mm+w-low)%w + w - (if mm < low then 1 else 0)) % w = p/w := by
  let q := p/w
  let l := p%w
  let mm := p%(w-1)
  have decomp : w*q+l = p := Nat.div_add_mod p w
  have low : l < w := Nat.mod_lt _ (by omega)
  have high : q < w-1 := by
    apply (Nat.div_lt_iff_lt_mul (by omega : 0 < w)).mpr
    exact Nat.lt_of_le_of_lt bound (Nat.mul_lt_mul_of_pos_left (by omega) (by omega))
  have modEq : mm = (q+l)%(w-1) := by
    change p%(w-1) = _
    have decomp' : p = q+l + q*(w-1) := by
      rw [Nat.mul_comm q (w-1), Nat.sub_mul, Nat.one_mul]
      have le : q ≤ w*q := by simpa using Nat.mul_le_mul_right q (show 1 ≤ w by omega)
      omega
    rw [decomp', Nat.mul_comm q (w-1), Nat.add_mul_mod_self_left]
  change ((mm + w - l) % w + w - (if mm < l then 1 else 0)) % w = q
  by_cases small : q+l < w-1
  · rw [Nat.mod_eq_of_lt small] at modEq
    have ge : ¬mm < l := by rw [modEq]; exact Nat.not_lt.mpr (Nat.le_add_left l q)
    rw [if_neg ge]
    have h : mm+w-l = q+w := by omega
    rw [h]
    simp [Nat.mod_eq_of_lt (by omega : q < w)]
  · have small' : q+l-(w-1) < w-1 := by omega
    rw [Nat.mod_eq_sub_mod (by omega), Nat.mod_eq_of_lt small'] at modEq
    have lt : mm < l := by omega
    rw [if_pos lt]
    have h : mm+w-l = q+1 := by omega
    rw [h, Nat.mod_eq_of_lt (by omega : q+1 < w)]
    have h' : q+1+w-1 = q+w := by omega
    rw [h']
    simp [Nat.mod_eq_of_lt (by omega : q < w)]

theorem highLimb (env : Env) (a b : Nat) (ha : a < R) (hb : b < R)
    (mmHere : env "mm" = some (a*b%(R-1))) (lowHere : env "low" = some (a*b%R)) :
    highExpr.run false env = some (a*b/R) := by
  have bound : a*b ≤ (R-1)*(R-1) := Nat.mul_le_mul (by omega) (by omega)
  rw [highResult _ _ _ (lt_trans (Nat.mod_lt _ (by decide : 0 < R-1)) (by decide))
    (Nat.mod_lt _ (Nat.two_pow_pos 256)) mmHere lowHere]
  exact congrArg some (recover R (a*b) (by decide) bound)
end Inv32High
