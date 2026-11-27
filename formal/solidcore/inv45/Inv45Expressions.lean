import Inv45WordOps
import Inv45AbsoluteShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv08.Authority
namespace Inv45
def Reads (c : Context) (r : Runtime) (e : Source.Expr) (v : Value) :=
  ∀ fuel, e.orderFuel ≤ fuel → e.evalFuel fuel c r = pure (v,r)
theorem readSignedLocal (c : Context) (r : Runtime) (nm : String) (v : Nat)
    (h : r.lookupLocal? nm=some (.int v)) : Reads c r (.var nm) (.int v) := by
  intro n enough;cases n with
  | zero => change 1≤0 at enough;omega
  | succ n =>
    have ns : r.lookupStorageBase? nm=none := by simp [Runtime.lookupStorageBase?,h]
    rw [Expr.evalFuel,ns,h];rfl
theorem readSignedLiteral (c : Context) (r : Runtime) (v : Nat) (W : v<R) :
    Reads c r (.intWord v) (.int v) := by
  intro n enough;cases n with
  | zero => change 1≤0 at enough;omega
  | succ n =>
    change pure (Value.int (v%R),r)=_
    rw [Nat.mod_eq_of_lt W]
theorem binary {c r l m a b x} (op : Source.BinaryOp) (A : Reads c r l a) (B : Reads c r m b)
    (ha : op ≠ .boolAnd) (hb : op ≠ .boolOr) (ok : op.apply c.checked a b=.ok x) :
    Reads c r (.binary op l m) x := by
  intro n enough; change l.orderFuel + m.orderFuel+1≤n at enough
  cases n with
  | zero => omega
  | succ n => exact Inv32Eval.binary n c r op ha hb l m a b x (A _ (by omega)) (B _ (by omega)) ok
theorem unary {c r e a x} (op : Source.UnaryOp) (A : Reads c r e a)
    (ok : op.apply c.checked a=.ok x) : Reads c r (.unary op e) x := by
  intro n enough;change e.orderFuel+1≤n at enough
  cases n with
  | zero => omega
  | succ n =>
    rw [Expr.evalFuel,A n (by omega)]
    simp only [bindPure,ok]; rfl
theorem intClean {c r e v} (A : Reads c r e (.int (Signed.word v))) (V : Signed.inRange v) :
    Reads c r (.castOp .intCleanup 256 e) (.int (Signed.word v)) := by
  intro n enough;change e.orderFuel+1≤n at enough
  cases n with
  | zero => omega
  | succ n =>
    rw [Expr.evalFuel,A n (by omega)]
    simp only [bindPure,Signed.clean _ _ V];rfl
theorem uintFromInt {c r e v} (A : Reads c r e (.int v)) (fit : v<R) (cleanup : Bool) :
    Reads c r (.castOp (if cleanup then .uintCleanup else .uintCast) 256 e) (.word v) := by
  have N : Shared.norm v=v := Nat.mod_eq_of_lt fit
  have U : uintCast? 256 (.int v)=.ok (.word v) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,N,Bind.bind,Except.bind]; exact fit
  have C : uintCleanup? c.checked 256 (.int v)=.ok (.word v) := by
    have B : Shared.norm v < 2^256 := by rw [N];exact fit
    simp only [uintCleanup?,Value.forceAbiLazy,Value.asStorageWord?,Bind.bind,Except.bind];simp [N,U]; intro _;exact fit
  cases cleanup <;> intro n enough <;> change e.orderFuel+1≤n at enough <;> cases n with
  | zero => omega
  | succ n =>
    rw [Expr.evalFuel,A n (by omega)]
    simp only [bindPure,U,C];rfl
end Inv45
