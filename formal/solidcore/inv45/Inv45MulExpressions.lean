import Inv45MulShape
import Inv45Expressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.MulDiv
theorem wordVar (c : Context) (r : Runtime) (name : String) (x : Nat) (fit : x<R)
    (localX : r.lookupLocal? name=some (.word x)) : Inv40.Reads c r (v name).value x :=
  Inv08.ReleaseQuote.readClean (Inv08.localReads _ _ _ _ localX) fit
theorem twiceReads {c r e x} (rd : Inv40.Reads c r (e : Pattern Source.Expr).value x) (fit : x<R) :
    Inv40.Reads c r (twice e).value x := Inv08.ReleaseQuote.readClean (Inv08.ReleaseQuote.readClean rd fit) fit
theorem productRead {c r l m a b} (L : Inv40.Reads c r (l : Pattern Source.Expr).value a)
    (M : Inv40.Reads c r (m : Pattern Source.Expr).value b) (A : a<R) (B : b<R) (un : c.checked=false) :
    Inv40.Reads c r (mul l m).value (a*b%R) := by
  have h := Inv32NewtonBody.mulWord (bv a) (bv b)
  simp only [BitVec.toNat_mul,Inv32WideAdapters.toNat _ A,Inv32WideAdapters.toNat _ B] at h
  apply twiceReads _ (Nat.mod_lt _ (Nat.two_pow_pos 256))
  apply Inv08.ReleaseQuote.binary L M .mul (by intro h;cases h) (by intro h;cases h)
  rw [un];exact h
theorem diffRead {c r l m a b} (L : Inv40.Reads c r (l : Pattern Source.Expr).value a)
    (M : Inv40.Reads c r (m : Pattern Source.Expr).value b) (A : a<R) (B : b<R) (un : c.checked=false) :
    Inv40.Reads c r (sub l m).value ((a+R-b)%R) := by
  apply twiceReads _ (Nat.mod_lt _ (Nat.two_pow_pos 256))
  apply Inv08.ReleaseQuote.binary L M .sub (by intro h;cases h) (by intro h;cases h)
  rw [un];exact Inv32ProductValues.subWord _ _ A B
theorem remainderRead {c r l m dst a b d} (L : Inv40.Reads c r (l : Pattern Source.Expr).value a)
    (M : Inv40.Reads c r (m : Pattern Source.Expr).value b) (D : Inv40.Reads c r (dst : Pattern Source.Expr).value d)
    (A : a<R) (B : b<R) (W : d<R) (positive : 0<d) :
    Inv40.Reads c r (clean (Expr_mulMod l m dst)).value (a*b%d) := by
  apply Inv08.ReleaseQuote.readClean _ (lt_trans (Nat.mod_lt _ positive) W)
  intro n enough
  change l.value.orderFuel+m.value.orderFuel+dst.value.orderFuel+1≤n at enough
  cases n with
  | zero => omega
  | succ n => exact Inv32Eval.mulmodExpression n c r _ _ _ _ _ _ A B W positive (L _ (by omega)) (M _ (by omega)) (D _ (by omega))
theorem conditionalWord {c r e b} (X : Inv40.Reads c r (e : Pattern Source.Expr).value (boolWord b)) :
    Inv40.Reads c r (testWord e).value (boolWord b) := by
  intro n enough
  change e.value.orderFuel+1+1+1≤n at enough
  cases n with
  | zero => omega
  | succ n =>
    change Expr.evalFuel (n+1) c r (.ternary e.value (.word 1) (.word 0))=_
    rw [Expr.evalFuel,X n (by omega)]
    cases b <;> first | exact Inv08.Authority.literal _ _ 0 (by decide) _ (by change 1≤n;omega)
                      | exact Inv08.Authority.literal _ _ 1 (by decide) _ (by change 1≤n;omega)
theorem recover (a b : Nat) (A : a<R) (B : b<R) :
    let mm := a*b%(R-1)
    let low := a*b%R
    ((mm+R-low)%R+R-(if mm<low then 1 else 0))%R=a*b/R := by
  let e : Inv32Scalar.Env := fun n => if n="mm" then some (a*b%(R-1)) else some (a*b%R)
  have i := Inv32High.highLimb e a b A B rfl rfl
  have j := Inv32High.highResult e (a*b%(R-1)) (a*b%R)
    (lt_trans (Nat.mod_lt _ (by decide)) (by decide)) (Nat.mod_lt _ (by decide)) rfl rfl
  exact Option.some.inj (j.symm.trans i)
end Inv45.MulDiv
