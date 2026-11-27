import Lean
namespace Inv02
def price (r k m : Nat) := (r*10000/m)*10^18/k

/-- Grid alignment eliminates rounding at the REP-to-base conversion. -/
theorem aligned (m r : Nat) (onGrid : m / m.gcd 10000 ∣ r) : m ∣ r*10000 := by
  obtain ⟨units,h⟩ := onGrid
  refine ⟨units*(10000/m.gcd 10000),?_⟩
  have mrec := Nat.div_mul_cancel (Nat.gcd_dvd_left m 10000)
  have brec := Nat.div_mul_cancel (Nat.gcd_dvd_right m 10000)
  calc r*10000 = ((m/m.gcd 10000)*units)*((10000/m.gcd 10000)*(m.gcd 10000)) := by rw [brec,h]
       _ = ((m/m.gcd 10000)*(m.gcd 10000))*(units*(10000/m.gcd 10000)) := by ac_rfl
       _ = _ := by rw [mrec]

theorem scaled (r k m n : Nat) (mp : 0<m) (np : 0<n) (grid : m/m.gcd 10000 ∣ r) :
    price (n*r) (n*k) m = price r k m := by
  obtain ⟨units,h⟩ := aligned m r grid
  unfold price
  rw [Nat.mul_assoc n r 10000,h,← Nat.mul_left_comm m n units,
    Nat.mul_div_cancel_left _ mp,Nat.mul_div_cancel_left _ mp,
    Nat.mul_assoc,Nat.mul_div_mul_left _ _ np]
end Inv02
