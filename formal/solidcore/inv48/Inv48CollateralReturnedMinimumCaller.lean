import Inv48CollateralReturnedMinimumClose
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralReturnedMinimum
open Inv48.CollateralCloneStage Inv48.CollateralMinimum Inv48.Minima
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- The numeric result is assigned to the actual public caller's collateral
return target, with its saved locals restored and the actual callee state. -/
theorem callerAssignment (s : Joined trace out) (d : BaseDeployment s) (x : Nat)
    (fit : x < Inv32Division.R)
    (X : s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) :
    ({ (tailState s.tailStart x d.base).popScope.popScope.popScope with
      locals := s.collateralSaved }).assignNamedValuesRef? [Inv48.Positive.ret1]
      [.word (d.base+Inv03.ceilQuot x 100)] = some s.publicFinal ∧
    s.collateralFinish = [] := by
  have result := returnedMinimum s d x fit X
  have run := s.collateralRun
  rw [result.2.1] at run
  have finish : internalCallFinish s.fn [Inv48.Positive.ret1] s.collateralSaved
      (((Result.returned (tailState s.tailStart x d.base) [.word (d.base+Inv03.ceilQuot x 100)]).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope |>.mapRuntime Runtime.popScope) =
    internalCallAssign { (tailState s.tailStart x d.base).popScope.popScope.popScope with
      locals := s.collateralSaved } [Inv48.Positive.ret1] [.word (d.base+Inv03.ceilQuot x 100)] := by
    simp [Result.mapRuntime,internalCallFinish,s.fnReturns,coerceReturnBindingsRef,
      coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  rw [finish,internalCallAssign] at run
  simp only [List.isEmpty,Bool.false_eq_true,if_false] at run
  split at run
  · rename_i updated eq
    have pure := pureResult run
    exact ⟨by rw [eq,← Result.normal.inj pure.2],pure.1⟩
  · have impossible := (pureResult run).2
    cases impossible
end Inv48.CollateralReturnedMinimum
