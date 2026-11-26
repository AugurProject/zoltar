import Inv05Guards
open SolidCore.Solidity.Source
namespace Inv05
theorem assignComparison (fuel : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (name : String) (old v : Nat) (left right : Expr)
    (bound : r.lookupLocal? name = some (.word old))
    (rhs : Expr.eval c r (.binary .ge left right) = pure (.word v,r))
    (store : r.assignLocal? name (.word v) = some next) :
    Stmt.eval (fuel+1) t c r (.assign (.var name) (.binary .ge left right)) = pure (.normal next) := by
  have notMem : (LValue.var name).wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs, Runtime.lookupMemoryRef?, bound]
  rw [Stmt.eval]
  dsimp only
  rw [notMem]
  simp only [Bool.false_eq_true, if_false, rhs]
  change (do
    match ← ((LValue.var name).resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.word v) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [Inv32Writes.resolve c r name old bound]
  have stored : (ResolvedLValue.local name).write c r (.word v) = .ok next := by simp [ResolvedLValue.write,store]
  change (match (ResolvedLValue.local name).write c r (.word v) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) = _
  rw [stored]

end Inv05
