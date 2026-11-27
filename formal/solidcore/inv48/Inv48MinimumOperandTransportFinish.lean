import Inv48MinimumOperandTransportState
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumOperandTransport
open Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.MinimumCollateralTrace Inv48.MinimumSuccessWords Inv48.MinimumSuffixPath
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- Preserve the complete actual callee poststate; replace only its restored
caller locals. No storage, memory or interaction effects are discarded. -/
def called (post base : Runtime) (p C : Nat) : Runtime :=
  { post with locals := ((saved (root base p) h0 0).pushScope.declareLocal ret1 (.word C)).locals }
def copied (post base : Runtime) (p C : Nat) : Runtime :=
  { post with locals := ((saved (root base p) h0 C).pushScope.declareLocal ret1 (.word C)).locals }
def collateralPost (post base : Runtime) (p C : Nat) : Runtime :=
  { post with locals := (phase1 base p C).locals }

 theorem finishCollateral (path : Path n c (start base p) trace out)
    (s : Collateral path) (fit : p < Inv32Division.R) (positive : 0 < p)
    (d : Inv48.CollateralCloneStage.Deployment s.joined.context s.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.joined)
    (env : CanonicalOracle s.joined.context s.joined.start d.root
      (Inv48.CollateralCloneStage.bytes d) s.joined.during) :
    ∃ response x C,
      OracleEvent s.joined.context s.joined.start d.root (Inv48.CollateralCloneStage.bytes d)
        s.joined.during response ∧ response.success = true ∧
      x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      C = b.base + Inv03.ceilQuot x 100 ∧ C < Inv32Division.R ∧
      s.cut.callFinal = called
        (Inv48.Minima.tailState s.joined.tailStart x b.base).popScope.popScope.popScope base p C ∧
      s.cut.copied = copied
        (Inv48.Minima.tailState s.joined.tailStart x b.base).popScope.popScope.popScope base p C ∧
      path.collateral = collateralPost
        (Inv48.Minima.tailState s.joined.tailStart x b.base).popScope.popScope.popScope base p C ∧
      path.collateral.lookupLocal? h0 = some (.word C) ∧
      path.collateral.lookupLocal? "proposedRepPerEthPrice" = some (.word p) := by
  obtain ⟨response,x,event,success,fitX,decoded,fitC,returned,assignment,tail,finish⟩ :=
    Inv48.CollateralReturnedMinimum.certificate s.joined d b env
  let C := b.base + Inv03.ceilQuot x 100
  let post := (Inv48.Minima.tailState s.joined.tailStart x b.base).popScope.popScope.popScope
  have guardedEq := guarded path fit positive
  have callerEq : s.cut.caller = (saved (root base p) h0 0).pushScope.declareLocal ret1 (.word 0) := by
    have run := s.cut.declareRun
    simp only [guardedEq,Stmt.evalList,Inv48.CloneGetters.decl_none] at run
    simp only [Ty.defaultValue,pure_bind,Stmt.evalList] at run
    exact Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have assigned : ({post with locals := s.cut.caller.locals}).assignNamedValuesRef? [ret1] [.word C] =
      some (called post base p C) := by
    rw [callerEq]
    simp [h0,ret1,called,root,start,saved,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
      Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?,Runtime.declareLocal,Runtime.pushScope,
      Runtime.withFrame,LocalEnv.declare]
  have callEq : s.cut.callFinal = called post base p C := by
    rw [s.savedEq,s.finalEq] at assignment
    exact Option.some.inj (assignment.symm.trans assigned)
  have old : (called post base p C).lookupLocal? h0 = some (.word 0) := by
    simp [h0,ret1,called,root,start,saved,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,
      Runtime.withFrame,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
  have ret : (called post base p C).lookupLocal? ret1 = some (.word C) := by
    simp [h0,ret1,called,root,start,saved,Runtime.pushScope,Runtime.withFrame,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
  have put : (called post base p C).assignLocal? h0 (.word C) = some (copied post base p C) := by
    simp [h0,ret1,called,copied,root,start,saved,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,
      LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,
      Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,LocalEnv.declare]
  have copy := Inv48.PositiveHoist.lastCopy (n+1) Inv48.Source.model.core.table c
    (called post base p C) (copied post base p C) h0 ret1 0 C old ret put
  have run := s.cut.copyRun
  rw [callEq,copy] at run
  have copyEq := Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have postEq : path.collateral = collateralPost post base p C := by
    rw [s.cut.scope,copyEq]
    rfl
  refine ⟨response,x,C,event,success,fitX,decoded,rfl,fitC,callEq,copyEq,postEq,?_,?_⟩
  all_goals rw [postEq]
  all_goals simp [h0,ret1,collateralPost,phase1,root,start,saved,Runtime.lookupLocal?,Runtime.declareLocal,
    Runtime.pushScope,Runtime.withFrame,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]

#print axioms finishCollateral
end Inv48.MinimumOperandTransport
