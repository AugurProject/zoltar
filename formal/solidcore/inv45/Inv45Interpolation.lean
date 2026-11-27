import Inv45AddExecution
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Scale
theorem distance (lo hi : Int) (L : Signed.inRange lo) (H : Signed.inRange hi) (ordered : lo<hi) :
    let d := (hi-lo).toNat
    0<d ∧ d<R ∧ ((Signed.word hi+R-Signed.word lo)%R)=d := by
  obtain ⟨ll,lh⟩ := L;obtain ⟨hl,hh⟩ := H
  let d := (hi-lo).toNat
  have eq : (↑d:Int)=hi-lo := Int.toNat_of_nonneg (by omega)
  have small : d<R := by norm_num [Signed.H,R] at *;omega
  refine ⟨by omega,small,?_⟩
  have WL := Signed.wordFit lo ⟨ll,lh⟩
  have WH := Signed.wordFit hi ⟨hl,hh⟩
  have rep (v : Int) (V : Signed.inRange v) : (↑(Signed.word v):Int)= if v<0 then v+↑R else v := by
    obtain ⟨l,h⟩ := V;unfold Signed.word;split
    · rw [Int.toNat_of_nonneg (by norm_num [R,Signed.H] at *;omega)]
    · rw [Int.toNat_of_nonneg (by omega)]
  have hrep := rep hi ⟨hl,hh⟩;have lrep := rep lo ⟨ll,lh⟩
  by_cases negL : lo<0 <;> by_cases negH : hi<0
  · rw [if_pos negH] at hrep;rw [if_pos negL] at lrep
    rw [show Signed.word hi+R-Signed.word lo=d+R by omega,Nat.add_mod_right,Nat.mod_eq_of_lt small]
  · rw [if_neg negH] at hrep;rw [if_pos negL] at lrep
    rw [show Signed.word hi+R-Signed.word lo=d by omega,Nat.mod_eq_of_lt small]
  · omega
  · rw [if_neg negH] at hrep;rw [if_neg negL] at lrep
    rw [show Signed.word hi+R-Signed.word lo=d+R by omega,Nat.add_mod_right,Nat.mod_eq_of_lt small]
theorem bounds (lo hi : Int) (n k : Nat) (L : Signed.inRange lo) (H : Signed.inRange hi)
    (ordered : lo<hi) (positive : 0<n) (valid : k≤n) :
    let q := quotient (hi-lo).toNat n k
    q<R ∧ Signed.inRange (lo+↑q) := by
  let d := (hi-lo).toNat
  have eq : (↑d:Int)=hi-lo := Int.toNat_of_nonneg (by omega)
  have fit : d<R := (distance lo hi L H ordered).2.1
  have bounded : quotient d n k ≤ d := by
    have h := Nat.div_le_div_right (c:=n) (Nat.mul_le_mul_right d valid)
    simpa only [Nat.mul_comm n d,Nat.mul_div_cancel _ positive] using h
  change quotient d n k<R ∧ Signed.inRange (lo+↑(quotient d n k))
  exact ⟨lt_of_le_of_lt bounded fit,⟨by have := L.1;omega,by have := H.2;omega⟩⟩
end Inv45.Scale
