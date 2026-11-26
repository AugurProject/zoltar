import Inv45Signed
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Signed
private theorem order (a b : Int) (A : inRange a) (B : inRange b) :
    EvmYul.UInt256.sltBool (Shared.toEvmWord (word a)) (Shared.toEvmWord (word b)) = decide (a<b) := by
  rw [evm _ (wordFit _ A), evm _ (wordFit _ B)]
  unfold EvmYul.UInt256.sltBool
  change (if H ≤ word a then (if H ≤ word b then decide (word a < word b) else true)
    else (if H ≤ word b then false else decide (word a < word b))) = decide (a<b)
  have u := decode (word a) (wordFit _ A)
  have v := decode (word b) (wordFit _ B)
  rw [decodeWord a A] at u
  rw [decodeWord b B] at v
  have f := wordFit a A
  have g := wordFit b B
  generalize word a = x at *
  generalize word b = y at *
  split_ifs at * <;> simp_all <;> norm_num [H,R] at * <;> omega

theorem ltWord (a b : Int) (A : inRange a) (B : inRange b) :
    Shared.sltWord (word a) (word b) = if a<b then 1 else 0 := by
  unfold Shared.sltWord Shared.liftEvmBinary EvmYul.UInt256.slt
  rw [order _ _ A B]
  by_cases h : a<b
  · rw [if_pos h,decide_eq_true h];rfl
  · rw [if_neg h,decide_eq_false h];rfl

theorem geWord (check : Bool) (a b : Int) (A : inRange a) (B : inRange b) :
    BinaryOp.apply check .ge (.int (word a)) (.int (word b)) = .ok (.word (if b≤a then 1 else 0)) := by
  change Except.ok (Value.word (boolWord (!(wordTruthy (Shared.sltWord _ _))))) = _
  rw [ltWord _ _ A B]
  by_cases h : a<b
  · rw [if_pos h,if_neg (by omega : ¬ b≤a)]; rfl
  · rw [if_neg h,if_pos (by omega : b≤a)]; rfl
end Inv45.Signed
