import Inv39Emit
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.ERC20
def entry (r : Runtime) (src dst val : Nat) := r.withFrame [("from",.word src),("to",.word dst),("value",.word val)]
def written (r : Runtime) (src dst val : Nat) : Runtime :=
  {r with state := afterTo (afterFrom r.state src val) dst val}
def updateResult (c : Context) (r : Runtime) (src dst val : Nat) :=
  ((eventResult c (written ((entry r src dst val).pushScope.pushScope) src dst val) src dst val).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope
private theorem last (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (s : Source.Stmt) (out : Result)
    (ev : Stmt.eval n t c r s = pure out) : Stmt.evalList n t c r [s] = pure out := by
  rw [Stmt.evalList,ev]
  have bind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
  cases out <;> simp only [bind,Stmt.evalList]
private theorem blockResult (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (ss : List Source.Stmt) (out : Result)
    (ev : Stmt.evalList n t c r.pushScope ss = pure out) :
    Stmt.eval (n+1) t c r (.block ss) = pure (out.mapRuntime Runtime.popScope) := by
  rw [Stmt.eval]; dsimp only; rw [ev]; rfl
theorem updateExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (src dst val : Nat)
    (srcWord : src<R) (dstWord : dst<R) (valWord : val<R)
    (debit : fromBounds r.state src val) (credit : toBounds (afterFrom r.state src val) dst val)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Stmt.eval (n+7) t c (entry r src dst val) body.value = pure (updateResult c r src dst val) := by
  let start := entry r src dst val
  let outer := start.pushScope
  let inner := outer.pushScope
  let deb := {inner with state := afterFrom r.state src val}
  let pay := written inner src dst val
  let out := eventResult c pay src dst val
  have F := fromRun t c inner n src val srcWord rfl rfl debit fields
  have T := toRun t c deb n dst val dstWord rfl rfl credit fields
  have E := emitTransfer c t pay (n+4) src dst val rfl rfl rfl events
  have innerSteps : Stmt.evalList (n+5) t c inner [fromStep.value,toStep.value,transferEvent.value] = pure out :=
    (seqStep _ _ _ _ _ _ _ F).trans ((seqStep _ _ _ _ _ _ _ T).trans (last _ _ _ _ _ _ E))
  have B := blockResult _ t c outer _ _ innerSteps
  have S : Stmt.eval (n+6) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have C := cleanParamExec (n+5) t c outer "value" val valWord rfl (by dsimp [outer,start,entry]; write_param)
  exact blockResult _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ S).trans ((seqStep _ _ _ _ _ _ _ S).trans
    ((seqStep _ _ _ _ _ _ _ C).trans (last _ _ _ _ _ _ B))))
end Inv39.ERC20
