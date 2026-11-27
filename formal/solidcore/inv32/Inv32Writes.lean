import Inv32Scalar
open SolidCore.Solidity.Source
namespace Inv32Writes

theorem resolve (c : Context) (r : Runtime) (name : String) (old : Nat)
    (bound : r.lookupLocal? name = some (.word old)) :
    (LValue.var name).resolveWithRuntime c r = pure (.local name, r) := by
  have noRef : r.lookupStorageBase? name = none := by simp [Runtime.lookupStorageBase?, bound]
  change Expr.resolveLValueFuel ((Expr.var name).orderFuel+1) c r (.var name) = _
  rw [Expr.resolveLValueFuel, noRef, bound]

theorem constant (fuel : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (name : String) (old v : Nat) (bound : r.lookupLocal? name = some (.word old))
    (store : r.assignLocal? name (.word (normWord v)) = some next) :
    Stmt.eval (fuel+1) t c r (.assign (.var name) (.word v)) = pure (Result.normal next) := by
  have notMem : (LValue.var name).wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs, Runtime.lookupMemoryRef?, bound]
  have rhs : Expr.eval c r (.word v) = pure (.word (normWord v), r) := by
    unfold Expr.eval; rw [Expr.evalFuel]
  rw [Stmt.eval]
  dsimp only
  rw [notMem]
  simp only [Bool.false_eq_true, if_false, rhs]
  change (do
    match ← ((LValue.var name).resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.word (normWord v)) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [resolve c r name old bound]
  have stored : (ResolvedLValue.local name).write c r (.word (normWord v)) = .ok next := by simp [ResolvedLValue.write,store]
  change (match (ResolvedLValue.local name).write c r (.word (normWord v)) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) = _
  rw [stored]

end Inv32Writes
