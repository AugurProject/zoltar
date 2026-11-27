import Inv32FloorFastPath
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions
namespace Inv32Compound
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem eb {α β : Type} (a : α) (k : α → SolI β) :
    (↑(Except.ok a : Except RevertData α) : SolI α) >>= k = k a := rfl

theorem expr (fuel : Nat) (op : BinaryOp) (c : Context) (r next : Runtime) (s : String)
    (old v out : Nat) (e : Expr) (look : r.lookupLocal? s = some (.word old))
    (rhs : Expr.evalFuel (fuel+1) c r e = pure (.word v,r))
    (valueEq : op.apply c.checked (.word old) (.word v) = .ok (.word out))
    (bound : out < R) (store : r.assignLocal? s (.word out) = some next) :
    Expr.evalFuel (fuel+2) c r (.assignment (some op) (some (.uint 256)) (.var s) e) =
      pure (.word out,next) := by
  have noStorage : r.lookupStorageBase? s = none := by simp [Runtime.lookupStorageBase?,look]
  have resolved : Expr.resolveLValueFuel (fuel+1) c r (.var s) = pure (.local s,r) := by
    rw [Expr.resolveLValueFuel,noStorage,look]
  have read : (ResolvedLValue.local s).read c r = .ok (.word old) := by
    simp [ResolvedLValue.read,ResolvedLValue.readRaw,look,Runtime.derefMemoryValue,Bind.bind,Except.bind]
  have written : (ResolvedLValue.local s).write c r (.word out) = .ok next := by simp [ResolvedLValue.write,store]
  have clean (b : Bool) : (ValueCleanup.uint 256).apply b (.word out) = .ok (.word out) :=
    Inv32Guards.cleanupWord b out bound
  rw [Expr.evalFuel,rhs]
  simp only [pb,resolved,read,valueEq,clean,written,eb]

theorem stmt (n : Nat) (t : FunctionTable) (op : BinaryOp) (c : Context)
    (r next : Runtime) (s : String) (old v out : Nat) (e : Formula)
    (size : e.depth ≤ (Expr.var s).orderFuel + e.core.orderFuel + 1)
    (look : r.lookupLocal? s = some (.word old)) (rhs : e.run c.checked (locals r) = some v)
    (valueEq : op.apply c.checked (.word old) (.word v) = .ok (.word out))
    (bound : out < R) (store : r.assignLocal? s (.word out) = some next) :
    Stmt.eval (n+1) t c r (.exprStmt (.assignment (some op) (some (.uint 256)) (.var s) e.core)) =
      pure (.normal next) := by
  have model : Models r (locals r) := by
    intro k w hw
    cases h : r.lookupLocal? k with
    | none => simp [locals,h] at hw
    | some val => cases val <;> simp_all [locals]
  have ev : Expr.eval c r (.assignment (some op) (some (.uint 256)) (.var s) e.core) =
      pure (.word out,next) :=
    expr _ op c r next s old v out e.core look (e.sound _ _ _ _ _ size model rhs) valueEq bound store
  rw [Stmt.eval]; dsimp only; rw [ev]; rfl
end Inv32Compound
