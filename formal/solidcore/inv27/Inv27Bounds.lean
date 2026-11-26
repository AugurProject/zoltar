import Inv03Budget
import Inv32Division
namespace Inv27
abbrev D : Nat := 10000000
abbrev M : Nat := Inv32Division.R-1
def lower (p e : Nat) := p*D/(D+e)
def upper (p e : Nat) := Inv03.ceilQuot (p*D) (D-e)
def maximum (e : Nat) := M*(D-e)/D
theorem fits_iff (p e : Nat) (he : e<D) : upper p e ≤ M ↔ p ≤ maximum e := by
  unfold upper maximum
  rw [Inv03.ceil_le _ _ _ (by omega),Nat.le_div_iff_mul_le (by decide)]
theorem maximumFits (e : Nat) : maximum e ≤ M := by
  unfold maximum
  exact (Nat.div_le_div_right (Nat.mul_le_mul_left M (Nat.sub_le _ _))).trans (by simp)
theorem lowerLe (p e : Nat) : lower p e ≤ p := by
  unfold lower
  exact (Nat.div_le_div_left (by omega : D≤D+e) (by decide : 0<D)).trans (by simp)
theorem zero (p : Nat) : lower p 0 = p ∧ upper p 0 = p := by
  constructor
  · simp [lower]
  · unfold upper
    apply Nat.le_antisymm
    · exact (Inv03.ceil_le _ _ _ (by decide)).mpr (by simp)
    · unfold Inv03.ceilQuot
      simp only [Nat.sub_zero,Nat.le_div_iff_mul_le (by decide : 0<D)]
      omega
theorem wider (p e f : Nat) (ordered : e≤f) (hf : f<D) :
    lower p f ≤ lower p e ∧ upper p e ≤ upper p f := by
  constructor
  · exact Nat.div_le_div_left (by omega : D+e≤D+f) (by omega : 0<D+e)
  · apply (Inv03.ceil_le _ _ _ (by omega : 0<D-e)).mpr
    exact le_trans ((Inv03.ceil_le _ _ _ (by omega : 0<D-f)).mp le_rfl)
      (Nat.mul_le_mul_left _ (by omega))
end Inv27
