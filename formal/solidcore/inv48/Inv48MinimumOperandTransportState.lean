import Inv48MinimumOperandTransportJoined
import Inv48PositiveRunCore
import Inv48MinimumGuardRuntime
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumOperandTransport
open Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.MinimumCollateralTrace Inv48.MinimumSuccessWords Inv48.MinimumSuffixPath
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

structure Collateral (path : Path n c r trace out) where
  cut : Simple n c path.guarded path.collateral h0 ret1 key1 path.collateralTrace
  joined : Inv48.CollateralReturnedMinimum.Joined trace out
  finalEq : joined.publicFinal = cut.callFinal
  savedEq : joined.collateralSaved = cut.caller.locals

theorem collateral (path : Path n c r trace out)
    (body : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      trace (.ok out)) : Nonempty (Collateral path) := by
  obtain ⟨cut⟩ := simple path.collateralRun
  obtain ⟨site,runtimeEq,_,_,split,entered,last⟩ := completedCollateral path cut body
  obtain ⟨joined,finalEq,savedEq⟩ := joinedAt site cut.callFinal cut.callTrace _ split entered last
  exact ⟨⟨cut,joined,finalEq,by rwa [runtimeEq] at savedEq⟩⟩

/-- The guard runtime is computed from this path's actual prologue and guard
executions. The price-fit premise is the ABI word domain, not a caller-state
or helper-result premise. -/
theorem guarded (path : Path n c (start base p) trace out)
    (fit : p < Inv32Division.R) (positive : 0 < p) :
    path.guarded = saved (root base p) h0 0 := by
  let outside := (start base p).pushScope
  have clean := Inv32FloorFastPath.cleanParamExec (n+3) Inv48.Source.model.core.table c outside
    "proposedRepPerEthPrice" p fit rfl (by dsimp [outside,start]; write_param)
  have pre : Stmt.evalList (n+4) Inv48.Source.model.core.table c outside prologue =
      pure (.normal outside) := by
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ clean).trans
    have skip : Stmt.eval (n+4) Inv48.Source.model.core.table c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip).trans
    simp [Stmt.evalList]
  have run := path.prologueRun
  rw [pre] at run
  have outsideEq := Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have run := path.guardRun
  rw [outsideEq] at run
  exact (Inv48.MinimumGuardRuntime.preserved n c base path.guarded p fit positive _ run).2

#print axioms collateral
#print axioms guarded
end Inv48.MinimumOperandTransport
