import Inv45AddShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
theorem wordNonneg (x : Nat) : Signed.word (x:Int)=x := by simp [Signed.word]
theorem intFromWord {c r e v} (X : Reads c r (e : Pattern Source.Expr).value (.word (Signed.word v))) (V : Signed.inRange v) :
    Reads c r (Shapes.signedCast e).value (.int (Signed.word v)) := by
  have H : intCleanup? c.checked 256 (.word (Signed.word v))=.ok (.int (Signed.word v)) := Signed.clean c.checked v V
  intro n enough;change e.value.orderFuel+1≤n at enough;cases n with
  | zero => omega
  | succ n =>
    change Expr.evalFuel (n+1) c r (.castOp .intCleanup 256 e.value)=_
    rw [Expr.evalFuel,X _ (by omega)];simp only [Inv08.Authority.bindPure,H];rfl
theorem intFromUint {c r e x} (X : Inv40.Reads c r (e : Pattern Source.Expr).value x) (fit : x<R) :
    Reads c r (intConvert e).value (.int x) := by
  have norm : Shared.norm x=x := Nat.mod_eq_of_lt fit
  have H : intCast? 256 (.word x)=.ok (.int x) := by
    simp [intCast?,Value.forceAbiLazy,Value.asStorageWord?,Bind.bind,Except.bind,norm]
    change (if Signed.H ≤ x%R then Shared.norm (wordModulus-R+x%R) else Shared.norm (x%R))=x
    simp [show wordModulus-R=0 from rfl,Nat.mod_eq_of_lt fit,norm]
  intro n enough;change e.value.orderFuel+1≤n at enough;cases n with
  | zero => omega
  | succ n =>
    change Expr.evalFuel (n+1) c r (.castOp .intCast 256 e.value)=_
    rw [Expr.evalFuel,X _ (by omega)];simp only [Inv08.Authority.bindPure,H];rfl
theorem maxRead (c : Context) (r : Runtime) : Inv40.Reads c r max.value (Signed.H-1) := by
  have F : Signed.H-1<R := by decide
  exact Inv08.ReleaseQuote.readClean (uintFromInt (readSignedLiteral c r _ F) F false) F
theorem addRead {c r l m a b} (L : Inv40.Reads c r (l : Pattern Source.Expr).value a)
    (M : Inv40.Reads c r (m : Pattern Source.Expr).value b) (fit : a+b<R) :
    Inv40.Reads c r (extra l m).value (a+b) := by
  apply MulDiv.twiceReads _ fit
  exact Inv08.ReleaseQuote.binary L M .add (by intro h;cases h) (by intro h;cases h) (Inv40.addWords _ _ _ fit)
theorem subRead {c r l m a b} (L : Inv40.Reads c r (l : Pattern Source.Expr).value a)
    (M : Inv40.Reads c r (m : Pattern Source.Expr).value b) (A : a<R) (B : b<R) (le : b≤a) :
    Inv40.Reads c r (MulDiv.sub l m).value (a-b) := by
  apply MulDiv.twiceReads _ (lt_of_le_of_lt (Nat.sub_le ..) A)
  exact Inv08.ReleaseQuote.binary L M .sub (by intro h;cases h) (by intro h;cases h) (Inv32QuoteExpr.subWord _ _ _ A B le)
theorem signedNeg (c : Context) (x : Nat) (pos : 0<x) (range : x<Signed.H) :
    Source.UnaryOp.apply c.checked .neg (.int x)=.ok (.int (Signed.word (-(x:Int)))) := by
  have fit : x<R := lt_trans range (by decide)
  have P : Signed.inRange (x:Int) := by constructor <;> omega
  have N : Signed.inRange (-(x:Int)) := by constructor <;> omega
  have D := Signed.decodeWord (x:Int) P
  rw [wordNonneg] at D
  have val : Signed.word (-(x:Int))=R-x := by
    unfold Signed.word; rw [if_pos (by omega)]
    apply Int.ofNat_inj.mp
    change (↑((-(x:Int)+↑R).toNat):Int)=↑(R-x)
    rw [Int.toNat_of_nonneg (by omega),Int.natCast_sub (by omega : x ≤ R)]
    ring
  have valid : signedInt256InRange (-(x:Int)) = true := by
    simp only [signedInt256InRange,Bool.and_eq_true,decide_eq_true_eq]
    constructor <;> norm_num [signedIntMin,signedIntMax,Signed.H,Shared.halfWordModulus] at * <;> omega
  have ok : checkedSignedNeg c.checked x=.ok (Signed.word (-(x:Int))) := by
    unfold checkedSignedNeg checkedSignedWord
    rw [D,valid]
    cases c.checked with
    | true => exact congrArg Except.ok (Signed.encode _ N)
    | false =>
      change Except.ok (Shared.subWord 0 x)=_
      rw [Signed.subRaw _ _ (by decide) fit,Nat.zero_add,Nat.mod_eq_of_lt (by omega),val]
  change (do let value ← checkedSignedNeg c.checked x;Except.ok (Value.int value))=_
  rw [ok];rfl
end Inv45.Add
