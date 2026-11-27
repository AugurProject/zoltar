import Inv32Division
namespace Inv45
namespace Scale
/-- Fixed-point integer before decimal rendering. -/
def quotient (d n k : Nat) := k*d/n
def display (lo : Int) (d n k : Nat) := lo+Int.ofNat (quotient d n k)
def tag (d n k : Nat) : Option Nat := if d<n ∧ k*d%n≠0 then some k else none

theorem monotone (lo : Int) (d n : Nat) : Monotone (display lo d n) := by
  intro x y h
  exact Int.add_le_add_left (Int.ofNat_le.mpr (Nat.div_le_div_right (Nat.mul_le_mul_right _ h))) lo

theorem leftEndpoint (lo : Int) (d n : Nat) : display lo d n 0=lo := by simp [display,quotient]
theorem rightEndpoint (lo hi : Int) (n : Nat) (rising : lo<hi) (positive : 0<n) :
    display lo (hi-lo).toNat n n=hi := by
  have diff : (0:Int)≤hi-lo := by omega
  unfold display quotient
  rw [Nat.mul_comm n _,Nat.mul_div_cancel _ positive]
  change lo+↑(hi-lo).toNat=hi
  rw [Int.toNat_of_nonneg diff];omega

theorem strictWhenWide {x y d n : Nat} (xy : x<y) (size : n≤d) (positive : 0<n) :
    quotient d n x < quotient d n y := by
  have le : x*d+n≤y*d := calc
    x*d+n ≤ x*d+d := Nat.add_le_add_left size _
    _ = (x+1)*d := (Nat.succ_mul x d).symm
    _ ≤ y*d := Nat.mul_le_mul_right _ xy
  have h : (x*d+n)/n≤y*d/n := Nat.div_le_div_right le
  unfold quotient; rwa [Nat.add_div_right _ positive] at h

theorem pairInjective {d n : Nat} (rise : 0<d) (positive : 0<n) :
    Function.Injective (fun k => (quotient d n k,tag d n k)) := by
  intro x y h
  have eq := congrArg Prod.fst h
  have tick := congrArg Prod.snd h
  change quotient d n x=quotient d n y at eq
  change tag d n x=tag d n y at tick
  by_cases dense : d<n
  · by_cases xr : x*d%n=0
    · have yr : y*d%n=0 := by by_contra bad; simp [tag,dense,xr,bad] at tick
      have px : quotient d n x*n=x*d := Nat.div_mul_cancel (Nat.dvd_of_mod_eq_zero xr)
      have py : quotient d n y*n=y*d := Nat.div_mul_cancel (Nat.dvd_of_mod_eq_zero yr)
      exact Nat.eq_of_mul_eq_mul_right rise (px.symm.trans ((congrArg (·*n) eq).trans py))
    · by_cases yr : y*d%n=0
      · simp [tag,dense,xr,yr] at tick
      · simpa [tag,dense,xr,yr] using tick
  · rcases lt_trichotomy x y with lt|same|gt
    · exact False.elim ((strictWhenWide lt (Nat.le_of_not_gt dense) positive).ne eq)
    · exact same
    · exact False.elim ((strictWhenWide gt (Nat.le_of_not_gt dense) positive).ne eq.symm)
end Scale
end Inv45
