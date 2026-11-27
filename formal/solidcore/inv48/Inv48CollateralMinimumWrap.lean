import Inv48CollateralMinimumAggregate
open SolidCore.Solidity.Source
namespace Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem wrapRun (fuel : Nat) (c : Context) (r final : Runtime) (rows : ScriptedResponder)
    (ss : List Stmt) (values : List Value)
    (body : (Stmt.evalList (fuel+1) table c r.pushScope.pushScope.pushScope ss).runWith rows = .ok (.returned final values)) :
    (Stmt.eval (fuel+4) table c r (.block [.skip,.block [.block ss]])).runWith rows =
      .ok (.returned final.popScope.popScope.popScope values) := by
  have inner := blockRun (fuel+1) c r.pushScope.pushScope rows ss (.returned final values) body
  have middle : (Stmt.eval (fuel+3) table c r.pushScope (.block [.block ss])).runWith rows =
      .ok (.returned final.popScope.popScope values) := by
    apply blockRun (fuel+2) c r.pushScope rows _ (.returned final.popScope values)
    rw [Stmt.evalList,Inv12.runWithBind,inner]
    rfl
  apply blockRun (fuel+3) c r rows _ (.returned final.popScope.popScope values)
  apply seqRun _ _ _ _ _ _ _ _ (congrArg (SolI.runWith rows) (show Stmt.eval (fuel+3) table c r.pushScope .skip = pure (.normal r.pushScope) by rw [Stmt.eval]))
  rw [Stmt.evalList,Inv12.runWithBind,middle]
  rfl

theorem finishWord (fn : InternalFunction) (target : String) (saved : LocalEnv)
    (r next : Runtime) (v : Nat)
    (returns : fn.returns = [⟨"_ret0",.uint256,false⟩])
    (assigned : ({r with locals := saved}).assignNamedValuesRef? [target] [.word v] = some next) :
    internalCallFinish fn [target] saved (.returned r [.word v]) = pure (.normal next) := by
  simp [internalCallFinish,returns,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,
    internalCallAssign,assigned,Bind.bind,Except.bind]
end Inv48.CollateralMinimum
