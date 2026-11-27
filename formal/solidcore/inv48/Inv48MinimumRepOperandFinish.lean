import Inv48MinimumRepOperandJoined
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumRepOperand
open Inv48.Positive Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
open Inv48.MinimumCollateralTrace Inv48.MinimumSuccessWords Inv48.MinimumSuffixPath
open Inv48.MinimumOperandTransport
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

structure Rep (path : Path n c r trace out) where
  stage : RepCut path
  joined : Inv48.RepReturnedMinimum.Joined trace out
  finalEq : joined.publicFinal = stage.cut.callFinal
  savedEq : joined.saved = stage.cut.caller.locals

theorem rep (path : Path n c r trace out)
    (body : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body)
      trace (.ok out)) : Nonempty (Rep path) := by
  obtain ⟨stage⟩ := repCut path
  obtain ⟨site,eq,split,entered,last⟩ := completed path stage body
  obtain ⟨joined,finalEq,savedEq⟩ := joinedAt site stage.cut.callFinal stage.cut.callTrace _ split entered last
  exact ⟨⟨stage,joined,finalEq,by rwa [eq] at savedEq⟩⟩

def repCalled (post base : Runtime) (p C R : Nat) : Runtime :=
  { post with locals := ((saved (phase1 base p C) h1 0).pushScope.declareLocal ret2 (.word R)).locals }
def repCopied (post base : Runtime) (p C R : Nat) : Runtime :=
  { post with locals := ((saved (phase1 base p C) h1 R).pushScope.declareLocal ret2 (.word R)).locals }
def repPost (post base : Runtime) (p C R : Nat) : Runtime :=
  { post with locals := (phase2 base p C R).locals }

theorem finishRep (path : Path n c r trace out) (s : Rep path)
    (collateralEq : path.collateral = collateralPost collateralState base p C)
    (d : Inv48.RepReturnedMinimum.Deployment s.joined.context s.joined.caller)
    (env : CanonicalOracle s.joined.context s.joined.start d.root
      (Inv48.RepReturnedMinimum.bytes d) s.joined.during) :
    ∃ response x R,
      OracleEvent s.joined.context s.joined.start d.root (Inv48.RepReturnedMinimum.bytes d)
        s.joined.during response ∧ response.success = true ∧
      x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      R = Inv03.ceilQuot x 100 ∧ R < Inv32Division.R ∧
      s.stage.cut.callFinal = repCalled
        (Inv48.RepReturnedMinimum.tailState s.joined.final x).popScope.popScope.popScope base p C R ∧
      s.stage.cut.copied = repCopied
        (Inv48.RepReturnedMinimum.tailState s.joined.final x).popScope.popScope.popScope base p C R ∧
      path.rep = repPost
        (Inv48.RepReturnedMinimum.tailState s.joined.final x).popScope.popScope.popScope base p C R ∧
      path.rep.lookupLocal? h0 = some (.word C) ∧
      path.rep.lookupLocal? h1 = some (.word R) ∧
      path.rep.lookupLocal? "proposedRepPerEthPrice" = some (.word p) := by
  obtain ⟨response,x,event,success,fitX,decoded,fitR,returned,assignment,tail,finish⟩ :=
    Inv48.RepReturnedMinimum.certificate s.joined d env
  let R := Inv03.ceilQuot x 100
  let post := (Inv48.RepReturnedMinimum.tailState s.joined.final x).popScope.popScope.popScope
  have declaredEq : s.stage.declared = saved (collateralPost collateralState base p C) h1 0 := by
    have run := s.stage.declareRun
    simp only [collateralEq,Stmt.evalList,Inv48.CloneGetters.decl_none] at run
    simp only [Ty.defaultValue,pure_bind,Stmt.evalList] at run
    exact Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have callerEq : s.stage.cut.caller =
      (saved (collateralPost collateralState base p C) h1 0).pushScope.declareLocal ret2 (.word 0) := by
    have run := s.stage.cut.declareRun
    simp only [declaredEq,Stmt.evalList,Inv48.CloneGetters.decl_none] at run
    simp only [Ty.defaultValue,pure_bind,Stmt.evalList] at run
    exact Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have assigned : ({post with locals := s.stage.cut.caller.locals}).assignNamedValuesRef? [ret2] [.word R] =
      some (repCalled post base p C R) := by
    rw [callerEq]
    simp [h0,h1,ret2,repCalled,collateralPost,phase1,root,start,saved,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
      Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?,Runtime.declareLocal,Runtime.pushScope,
      Runtime.withFrame,LocalEnv.declare]
  have callEq : s.stage.cut.callFinal = repCalled post base p C R := by
    rw [s.savedEq,s.finalEq] at assignment
    exact Option.some.inj (assignment.symm.trans assigned)
  have old : (repCalled post base p C R).lookupLocal? h1 = some (.word 0) := by
    simp [h0,h1,ret2,repCalled,phase1,root,start,saved,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,
      Runtime.withFrame,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
  have ret : (repCalled post base p C R).lookupLocal? ret2 = some (.word R) := by
    simp [h0,h1,ret2,repCalled,phase1,root,start,saved,Runtime.pushScope,Runtime.withFrame,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
  have put : (repCalled post base p C R).assignLocal? h1 (.word R) = some (repCopied post base p C R) := by
    simp [h0,h1,ret2,repCalled,repCopied,phase1,root,start,saved,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,
      LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,
      Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,LocalEnv.declare]
  have copy := Inv48.PositiveHoist.lastCopy (n+1) Inv48.Source.model.core.table c
    (repCalled post base p C R) (repCopied post base p C R) h1 ret2 0 R old ret put
  have run := s.stage.cut.copyRun
  rw [callEq,copy] at run
  have copyEq := Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2
  have postEq : path.rep = repPost post base p C R := by
    rw [s.stage.cut.scope,copyEq]
    rfl
  refine ⟨response,x,R,event,success,fitX,decoded,rfl,fitR,callEq,copyEq,postEq,?_,?_,?_⟩
  all_goals rw [postEq]
  all_goals simp [h0,h1,ret2,repPost,phase2,phase1,root,start,saved,Runtime.lookupLocal?,Runtime.declareLocal,
    Runtime.pushScope,Runtime.withFrame,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]

#print axioms rep
#print axioms finishRep
end Inv48.MinimumRepOperand
