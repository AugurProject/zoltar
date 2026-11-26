import Inv45TickGuardReads
open SolidCore.Solidity.Source
namespace Inv45.Public
theorem assignMatch (fuel : Nat) (c : Context) (r : Runtime) (n : Nat) (N : n<Inv32Division.R)
    (a : r.lookupLocal? "sum"=some (.word n)) (b : r.lookupLocal? "#read1617"=some (.word n))
    (prev : r.lookupLocal? "#cond1619"=some (.word 1)) (unchanged : r.assignLocal? "#cond1619" (.word 1)=some r) :
    Stmt.eval (fuel+1) model.core.table c r (.assign (.var "#cond1619") sumMatches)=pure (.normal r) := by
  have M : (LValue.var "#cond1619").wantsMemoryRefRhs r=false := by simp [LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,prev]
  have E : Expr.eval c r sumMatches=pure (.word 1,r) := sumMatchRead _ _ _ N a b _ (Nat.le_succ _)
  unfold sumMatches at E ⊢
  rw [Stmt.eval];dsimp only;rw [M]
  simp only [Bool.false_eq_true,if_false,E]
  change (do match ← ((LValue.var "#cond1619").resolveWithRuntime c r).caught with
             | .ok (target,r') => match target.write c r' (.word 1) with
               | .ok updated => pure (Result.normal updated)
               | .error err => pure (Result.reverted r err)
             | .error err => pure (Result.reverted r err))=_
  rw [Inv32Writes.resolve c r _ 1 prev]
  change (match (ResolvedLValue.local "#cond1619").write c r (.word 1) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (.reverted r err))=_
  simp [ResolvedLValue.write,unchanged]

theorem trueLocal (fuel : Nat) (c : Context) (r : Runtime) (yes no : Stmt)
    (cond : r.lookupLocal? "#cond1619"=some (.word 1)) :
    Stmt.eval (fuel+1) model.core.table c r (.ifElse (.var "#cond1619") yes no)=Stmt.eval fuel model.core.table c r yes := by
  rw [Stmt.eval];dsimp only
  have read : Expr.eval c r (.var "#cond1619")=pure (.word 1,r) := Inv32Guards.readWord _ _ _ _ _ cond
  rw [read];rfl
end Inv45.Public
