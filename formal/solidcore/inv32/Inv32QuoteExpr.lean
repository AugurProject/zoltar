import Inv32CeilCall
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product
namespace Inv32QuoteExpr
def w (s : String) := clean (localWord s)
def bps := choice (literal 1) (literal 10000) (literal 10000)
def positive (s : String) := Inv32WideGuards.gtF (w s) (literal 0)
def smaller (a b : String) := ltF (w a) (w b)
def validFee := ltF (w "feeBps") bps
def nonnegativeSub (a b : Formula) := Inv32NewtonBody.twice (subF a b)
def castCopy (n : String) := clean (cast .uint 256 (localWord n))
theorem bpsValue (c : Bool) (env : Env) : bps.run c env = some 10000 := rfl
theorem gt (c : Bool) (a b : Nat) (ha : a<R) (hb : b<R) :
    Source.BinaryOp.apply c .gt (.word a) (.word b) = .ok (.word (if b<a then 1 else 0)) := Inv32WideGuards.gtWord _ _ ha hb
theorem lt (c : Bool) (a b : Nat) (ha : a<R) (hb : b<R) :
    Source.BinaryOp.apply c .lt (.word a) (.word b) = .ok (.word (if a<b then 1 else 0)) := Inv32ProductValues.ltWord _ _ ha hb
theorem comparison (c : Bool) (env : Env) (x y : Formula) (a b : Nat) (ha : a<R) (hb : b<R)
    (X : x.run c env = some a) (Y : y.run c env = some b) :
    (ltF x y).run c env = some (boolWord (decide (a<b))) := by
  simp [ltF,binary,X,Y,lt _ _ _ ha hb,projectWord,boolWord]
theorem less (c : Bool) (env : Env) (x y : String) (a b : Nat) (ha : a<R) (hb : b<R)
    (X : env x = some a) (Y : env y = some b) :
    (smaller x y).run c env = some (boolWord (decide (a<b))) :=
  comparison _ _ _ _ _ _ ha hb (Inv32ProductValues.cleanup (localWord x) c env _ ha X)
    (Inv32ProductValues.cleanup (localWord y) c env _ hb Y)
theorem positiveValue (c : Bool) (env : Env) (x : String) (a : Nat) (ha : a<R) (X : env x = some a) :
    (positive x).run c env = some (boolWord (decide (0<a))) := by
  have C := Inv32ProductValues.cleanup (localWord x) c env _ ha X
  simp [positive,Inv32WideGuards.gtF,w,binary,C,literal,show normWord 0 = 0 by decide,gt c a 0 ha (by decide),projectWord,boolWord]
theorem feeValue (c : Bool) (env : Env) (f : Nat) (hf : f<R) (F : env "feeBps" = some f) :
    validFee.run c env = some (boolWord (decide (f<10000))) :=
  comparison _ _ _ _ _ _ hf (by decide) (Inv32ProductValues.cleanup (localWord "feeBps") c env _ hf F) (bpsValue _ _)
theorem subWord (c : Bool) (a b : Nat) (ha : a<R) (hb : b<R) (le : b≤a) :
    Source.BinaryOp.apply c .sub (.word a) (.word b) = .ok (.word (a-b)) := by
  have mod : (a+R-b)%R = a-b := by rw [show a+R-b = (a-b)+R by omega,Nat.add_mod_right,Nat.mod_eq_of_lt (lt_of_le_of_lt (Nat.sub_le _ _) ha)]
  have V := Inv32ProductValues.subWord a b ha hb
  rw [mod] at V
  have same : Source.checkedSub c a b = Source.checkedSub false a b := by
    simp [Source.checkedSub,show Shared.norm a = a from Nat.mod_eq_of_lt ha,show Shared.norm b = b from Nat.mod_eq_of_lt hb,Nat.not_lt_of_ge le]
  simpa [Source.BinaryOp.apply,Source.BinaryOp.applyWord,Source.BinaryOp.preservesFixedBytesWidth,
    Value.forceAbiLazy,Bind.bind,Except.bind,same] using V
theorem subValue (c : Bool) (env : Env) (x y : Formula) (a b : Nat) (ha : a<R) (hb : b<R) (le : b≤a)
    (X : x.run c env = some a) (Y : y.run c env = some b) :
    (nonnegativeSub x y).run c env = some (a-b) := by
  have small := lt_of_le_of_lt (Nat.sub_le a b) ha
  apply Inv32ProductValues.cleanup _ _ _ _ small; apply Inv32ProductValues.cleanup _ _ _ _ small
  simp [subF,binary,X,Y,subWord _ _ _ ha hb le,projectWord]
theorem castValue (c : Bool) (env : Env) (s : String) (v : Nat) (hv : v<R) (look : env s = some v) :
    (castCopy s).run c env = some v := by
  have castOk : uintCast? 256 (.word v) = .ok (.word v) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,show Shared.norm v=v from Nat.mod_eq_of_lt hv,
      Nat.mod_eq_of_lt hv, Bind.bind,Except.bind]; exact hv
  apply Inv32ProductValues.cleanup _ _ _ _ hv
  simp [Inv32Scalar.cast,localWord,look,castOk,projectWord]
end Inv32QuoteExpr
