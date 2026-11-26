import Inv32Division
open SolidCore.Solidity Inv32Division
namespace Inv32Rounding

private theorem normId {n : Nat} (hn : n < R) : Shared.norm n = n :=
  Nat.mod_eq_of_lt hn

private theorem wordVal (n : Nat) (hn : n < R) :
    (Shared.toEvmWord n).val.val = n := by
  change (n%R)%R = n
  simp [Nat.mod_eq_of_lt hn]

theorem remainder (a b d : Nat) (ha : a < R) (hb : b < R)
    (hd : d < R) (pos : 0 < d) :
    Source.checkedMulMod a b d = .ok (a*b%d) := by
  have nz : Source.wordEq d 0 = false := by
    unfold Source.wordEq
    rw [normId hd]; change (d == 0) = false; simp [Nat.ne_of_gt pos]
  simp only [Source.checkedMulMod,nz,Bool.false_eq_true,if_false]
  unfold Shared.mulmodWord Shared.liftEvmTernary EvmYul.UInt256.mulMod
  have evmNZ : EvmYul.UInt256.eq0 (Shared.toEvmWord d) = false := by
    have v := wordVal d hd
    generalize Shared.toEvmWord d = ev at *
    cases ev with
    | mk val =>
      change (val == (0 : Fin EvmYul.UInt256.size)) = false
      apply beq_eq_false_iff_ne.mpr
      intro h
      subst val
      change 0 = d at v
      omega
  rw [evmNZ]
  change Except.ok ((((Shared.toEvmWord a).val.val * (Shared.toEvmWord b).val.val %
    (Shared.toEvmWord d).val.val) % R) % R) = _
  rw [wordVal a ha,wordVal b hb,wordVal d hd]
  simp [Nat.mod_eq_of_lt (lt_trans (Nat.mod_lt _ pos) hd)]

theorem addition (q flag : Nat) (hq : q < R) (hf : flag < R) :
    (Source.BinaryOp.applyWord true .add q flag).toOption =
      if q+flag < R then some (q+flag) else none := by
  unfold Source.BinaryOp.applyWord Source.checkedAdd
  rw [normId hq, normId hf]
  by_cases small : q+flag < R
  · simp only [if_pos small]
    rw [if_neg (by simp; exact small)]
    change some ((((Shared.toEvmWord q).val.val + (Shared.toEvmWord flag).val.val) % R) % R) = _
    rw [wordVal q hq,wordVal flag hf]; simp [Nat.mod_eq_of_lt small]
  · rw [if_neg small, if_pos (by simp; exact Nat.le_of_not_gt small)]
    rfl

def rounded (a b d : Nat) : Option Nat := do
  let q ← divideLimbs (a*b) d
  let remn ← (Source.checkedMulMod a b d).toOption
  (Source.BinaryOp.applyWord true .add q (if remn > 0 then 1 else 0)).toOption

theorem ceil_identity (p d : Nat) (pos : 0 < d) :
    p/d + (if 0 < p%d then 1 else 0) = (p+d-1)/d := by
  have decomp := Nat.div_add_mod p d
  have small := Nat.mod_lt p pos
  have split : p+d-1 = (p%d+d-1) + d*(p/d) := by omega
  rw [split, Nat.add_mul_div_left _ _ pos, Nat.add_comm]
  by_cases r : 0 < p%d
  · have aux : p%d+d-1 = (p%d-1)+d := by omega
    rw [if_pos r, aux, Nat.add_div_right _ pos, Nat.div_eq_of_lt (show p%d-1 < d by omega)]
  · rw [if_neg r, Nat.div_eq_of_lt (show p%d+d-1 < d by omega)]

theorem rounded_correct (a b d : Nat) (ha : a < R) (hb : b < R) (hd : d < R) :
    rounded a b d = if d=0 ∨ R ≤ (a*b+d-1)/d then none else some ((a*b+d-1)/d) := by
  unfold rounded
  rw [divideLimbs_correct _ _ hd]
  by_cases zero : d=0
  · simp [zero]
  have pos : 0 < d := by omega
  have ceiling := ceil_identity (a*b) d pos
  rw [remainder _ _ _ ha hb hd pos]
  by_cases fits : a*b/d < R
  · simp only [zero, false_or, if_neg (Nat.not_le.mpr fits), Option.bind_some,
      Except.toOption, Option.bind_eq_bind]
    change (Source.BinaryOp.applyWord true .add (a*b/d) (if 0 < a*b%d then 1 else 0)).toOption = _
    rw [addition _ (if 0 < a*b%d then 1 else 0) fits (by split <;> decide), ceiling]
    split <;> split <;> simp_all <;> omega
  · have over : R ≤ (a*b+d-1)/d := by omega
    simp [zero, Nat.le_of_not_gt fits, over]

end Inv32Rounding
