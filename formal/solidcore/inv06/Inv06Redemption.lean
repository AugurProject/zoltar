import Mathlib.Tactic.Ring
import Inv05Issuance
namespace Inv06
/-- The successful mint's precision test lower-bounds the post-mint quote.
The issuance remainder upper-bounds that same quote. -/
theorem immediate (c u n a : Nat) (up : 0<u)
    (low : (c-1)*10^9 ≤ a*n/u) (high : a*n ≤ c*10^9*u) :
    let raw := a*(n+c*10^9)/((u+a)*10^9)
    raw=c ∨ raw=c-1 := by
  let s := 10^9
  let den := (u+a)*s
  let paid := a*(n+c*s)
  have dp : 0<den := Nat.mul_pos (by omega) (by decide)
  have left : (c-1)*den ≤ paid := by
    have first := (Nat.le_div_iff_mul_le up).mp low
    have last := Nat.mul_le_mul_right a (Nat.mul_le_mul_right s (Nat.sub_le c 1))
    calc
      (c-1)*den = (c-1)*s*u + (c-1)*s*a := by dsimp [den]; ring
      _ ≤ a*n+(c*s)*a := Nat.add_le_add first last
      _ = paid := by dsimp [paid]; ring
  have right : paid ≤ den*c := by
    calc
      paid = a*n + (c*s)*a := by dsimp [paid]; ring
      _ ≤ c*s*u + (c*s)*a := Nat.add_le_add_right high _
      _ = den*c := by dsimp [den]; ring
  have lo := (Nat.le_div_iff_mul_le dp).mpr left
  have hi := Nat.div_le_of_le_mul right
  change paid/den=c ∨ paid/den=c-1
  omega
end Inv06
