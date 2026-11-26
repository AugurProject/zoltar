import Inv32ExecutionBridge
open Inv32Newton

namespace Inv32Division
abbrev R : Nat := 2^256
abbrev bv (n : Nat) := BitVec.ofNat 256 n

private theorem splitOdd (d : Nat) (pos : 0 < d) :
    ∃ k o, d = o * 2^k ∧ o % 2 = 1 := by
  induction d using Nat.strong_induction_on with
  | h d ih =>
    by_cases odd : d%2 = 1
    · exact ⟨0,d,by simp,odd⟩
    · obtain ⟨k,o,eqn,odd'⟩ := ih (d/2) (Nat.div_lt_self pos (by decide)) (by omega)
      refine ⟨k+1,o,?_,odd'⟩
      rw [Nat.pow_succ, ← Nat.mul_assoc, ← eqn]
      omega

private theorem oddBit (o : Nat) (small : o < R) (odd : o % 2 = 1) :
    bv o &&& 1 = 1 := by
  apply BitVec.eq_of_toNat_eq
  rw [BitVec.toNat_and, BitVec.toNat_ofNat, Nat.mod_eq_of_lt small]
  exact (Nat.and_one_is_mod o).trans odd

private theorem lowbit (d o k : Nat) (h : d = o * 2^k) (odd : bv o &&& 1 = 1)
    (small : 2^k < R) :
    (bv d &&& -(bv d)).toNat = 2^k := by
  have cast : bv d = bv o <<< k := by
    unfold bv
    rw [h, BitVec.shiftLeft_eq_mul_twoPow, BitVec.ofNat_mul]
    apply congrArg (BitVec.ofNat 256 o * ·)
    apply BitVec.eq_of_toNat_eq
    rw [BitVec.toNat_twoPow, BitVec.toNat_ofNat]
  rw [cast, lowbitOfShift _ odd, BitVec.toNat_shiftLeft, Nat.shiftLeft_eq]
  simpa using small

/-- Source word arithmetic after the mul512 call, including the borrow and the
    wrapped high-limb multiplier for an odd denominator. -/
def divideLimbs (p d : Nat) : Option Nat := Id.run do
  let hi := p/R
  let lo := p%R
  if d = 0 then return none
  if hi = 0 then return some (lo/d)
  if d ≤ hi then return none
  let remn := p % d
  let h := hi - (if remn > lo then 1 else 0)
  let l := (lo + R - remn) % R
  let t := (bv d &&& -(bv d)).toNat
  let flipped := (((R-t)/t)+1)%R
  let merged := (l/t) ||| ((h*flipped)%R)
  return some ((bv merged * iterate (bv (d/t)) 6).toNat)

theorem divideLimbs_correct (p d : Nat) (small : d < R) :
    divideLimbs p d = if d=0 ∨ R ≤ p/d then none else some (p/d) := by
  unfold divideLimbs
  dsimp only
  by_cases z : d = 0
  · simp [z]
  have pos : 0 < d := by omega
  have over : R ≤ p/d ↔ d ≤ p/R := by
    rw [Nat.le_div_iff_mul_le pos, Nat.le_div_iff_mul_le (Nat.two_pow_pos 256), Nat.mul_comm]
  by_cases hi : p/R = 0
  · have b : p < R := (Nat.div_eq_zero_iff.mp hi).resolve_left (by decide)
    have q := Nat.div_le_self p d
    simp [z, hi, Nat.mod_eq_of_lt b, show ¬ R ≤ p/d by omega]
  by_cases large : d ≤ p/R
  · simp [z, hi, large, over]
  have fits : p/d < R := by omega
  obtain ⟨k,o,decmp,odd⟩ := splitOdd d pos
  have op : 0 < o := by omega
  have tp : 0 < 2^k := Nat.two_pow_pos _
  have tSmall : 2^k < R := lt_of_le_of_lt (by rw [decmp]; exact Nat.le_mul_of_pos_left _ op) small
  have oSmall : o < R := lt_of_le_of_lt (by rw [decmp]; exact Nat.le_mul_of_pos_right _ tp) small
  have hk : k ≤ 256 := by
    by_contra! big
    exact (Nat.not_le_of_gt tSmall) (Nat.pow_le_pow_right (by decide) (by omega))
  have bit := oddBit o oSmall odd
  have low := lowbit d o k decmp bit tSmall
  have den : d / 2^k = o := by rw [decmp, Nat.mul_div_cancel _ tp]
  have base : R = 2^(256-k)*2^k := by unfold R; rw [← Nat.pow_add, Nat.sub_add_cancel hk]
  have flip : (R-2^k)/2^k+1 = 2^(256-k) := by
    have nz := Nat.two_pow_pos (256-k)
    calc
      _ = ((2^(256-k)-1)*2^k)/2^k+1 := by rw [Nat.sub_mul, Nat.one_mul, ← base]
      _ = _ := by rw [Nat.mul_div_cancel _ tp]; omega
  let remn := p%d
  let h := p/R - (if remn > p%R then 1 else 0)
  let l := (p%R+R-remn)%R
  have sub : h*R+l = p-remn := subtractRemainder _ _ (lt_trans (Nat.mod_lt _ pos) small) (Nat.mod_le _ _)
  have join := joinShift h l k hk (Nat.mod_lt _ (Nat.two_pow_pos 256))
  rw [Nat.mul_comm R h, sub] at join
  have quotient := recoverQuotient p (2^k) o tp bit (decmp ▸ fits)
  rw [←decmp] at quotient
  simp only [z,hi,large,over,if_false,false_or,low,den,flip]
  change some ((bv (l / 2^k ||| h*(2^(256-k)%R)%R) * iterate (bv o) 6).toNat) = _
  rw [Nat.mul_mod_mod, Nat.mul_comm h, Nat.or_comm, join]
  simpa [bv, remn] using congrArg some quotient

end Inv32Division
