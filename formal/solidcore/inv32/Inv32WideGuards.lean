import Inv32WideWords
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32NewtonBody
namespace Inv32WideGuards
def gtF := binary .gt (by intro h; cases h) (by intro h; cases h)
def leF := binary .le (by intro h; cases h) (by intro h; cases h)
private theorem ev (n : Nat) (h : n < R) : (Shared.toEvmWord n).val.val = n := by
  change (n%R)%R = n
  simp [Nat.mod_eq_of_lt h]
theorem eqWord (c : Bool) (a b : Nat) (ha : a < R) (hb : b < R) :
    Source.BinaryOp.apply c .eq (.word a) (.word b) = .ok (.word (if a=b then 1 else 0)) := by
  change .ok (.word (boolWord (wordEq a b))) = (_ : Except RevertData Value)
  have A : Shared.norm a = a := Nat.mod_eq_of_lt ha
  have B : Shared.norm b = b := Nat.mod_eq_of_lt hb
  by_cases h : a=b <;> simp [wordEq,boolWord,A,B,h]
theorem gtWord (a b : Nat) (ha : a < R) (hb : b < R) :
    Source.BinaryOp.apply false .gt (.word a) (.word b) = .ok (.word (if b<a then 1 else 0)) := by
  have h : (Shared.toEvmWord a > Shared.toEvmWord b) ↔ b < a := by
    change (Shared.toEvmWord b).val.val < (Shared.toEvmWord a).val.val ↔ _
    rw [ev _ ha,ev _ hb]
  simp [Source.BinaryOp.apply, Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,Source.BinaryOp.applyWord,
    Shared.gtWord,Shared.liftEvmBinary,EvmYul.UInt256.gt,h,Bind.bind,Except.bind]
  by_cases lt : b < a <;> simp [lt,Bool.toUInt256] <;> rfl

theorem leWord (a b : Nat) (ha : a < R) (hb : b < R) :
    Source.BinaryOp.apply false .le (.word a) (.word b) = .ok (.word (if a≤b then 1 else 0)) := by
  have h : (Shared.toEvmWord a > Shared.toEvmWord b) ↔ b < a := by
    change (Shared.toEvmWord b).val.val < (Shared.toEvmWord a).val.val ↔ _
    rw [ev _ ha,ev _ hb]
  simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,Source.BinaryOp.applyWord,
    Shared.gtWord,Shared.liftEvmBinary,EvmYul.UInt256.gt,h,Bind.bind,Except.bind]
  by_cases lt : b<a
  · simp [lt,Bool.toUInt256,boolWord,wordTruthy,show ¬ a ≤ b by omega]; decide
  · simp [lt,Bool.toUInt256,boolWord,wordTruthy,show a ≤ b by omega]; rfl

def zeroTest (name : String) := eqF (clean (localWord name)) (literal 0)
theorem zeroValue (c : Bool) (env : Env) (name : String) (v : Nat) (hv : v < R)
    (read : env name = some v) : (zeroTest name).run c env = some (if v=0 then 1 else 0) := by
  have h := Inv32ProductValues.cleanup (localWord name) c env _ hv read
  have lit : (literal 0).run c env = some 0 := rfl
  simp only [zeroTest,eqF,binary,h,lit]
  change projectWord (Source.BinaryOp.apply c .eq (.word v) (.word 0)) = _
  rw [eqWord _ _ _ hv (by decide)]; rfl
end Inv32WideGuards
