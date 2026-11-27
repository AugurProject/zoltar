import Inv48QuoteMinimumEventsCollateralRead
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteMinimumEvents
open Inv48.CollateralReturnedMinimum Inv48.CollateralCloneStage Inv48.CollateralMinimum Inv48.Minima
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
theorem collateralBaseEvents (s : Joined trace out) (d : BaseDeployment s) :
    s.baseTrace = [] ∧ s.mid = baseState s.baseStart d.base := by
  have first := baseDeclaration s.sourceN s.sourceContext s.baseStart d.field d.base
    d.found d.type d.stored d.fit
  have run := Inv48.CollateralCloneFuel.replayList (Nat.le_add_right s.sourceN 1) _ _ _ _ _ _ s.baseRun
  rw [Stmt.evalList,first] at run
  change Interaction.Executes (Stmt.evalList (s.sourceN+1) table s.sourceContext
    (s.baseStart.declareLocal operand (.word d.base)) [.varDecl .uint256 Inv03.Bodies.tmp none]) _ _ at run
  rw [Stmt.evalList,Inv48.CloneGetters.decl_none] at run
  simp only [Ty.defaultValue, pure_bind, Stmt.evalList] at run
  obtain ⟨empty,eq⟩ := pureResult run
  exact ⟨empty,Result.normal.inj eq⟩

theorem collateralFinishEvents (s : Joined trace out) (d : BaseDeployment s) (x : Nat)
    (fit : x < Inv32Division.R)
    (X : s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) :
    s.aggregateFinish = [] ∧ s.callFinal = assigned s x := by
  have ret := (aggregateReturn s x fit X).1
  have run := s.finishRun
  rw [ret] at run
  have canonical : internalCallFinish aggregateFn [aggregateRet] s.saved
      (((Result.returned s.final [.word x]).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope |>.mapRuntime Runtime.popScope) =
      pure (.normal (assigned s x)) := by
    rw [s.savedEq,s.callerEq,baseRecovered s d]
    cases h : s.baseStart.locals <;>
      simp [internalCallFinish,aggregateFn,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,
        Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,
        internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
        Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,
        assigned,Inv32OneArg.store,restored,s.callerEq,baseRecovered s d,baseState,
        Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,Result.mapRuntime,h,
        Bind.bind,Except.bind]
  rw [canonical] at run
  exact ⟨(pureResult run).1,Result.normal.inj (pureResult run).2⟩
theorem collateralCopyEvents (s : Joined trace out) (d : BaseDeployment s) (x : Nat)
    (fit : x < Inv32Division.R)
    (X : s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) :
    s.copyTail = [] := by
  have cf := finishRecovered s d x fit X
  have old : s.callFinal.lookupLocal? Inv03.Bodies.tmp = some (.word 0) := by
    rw [cf]
    cases h : s.baseStart.locals <;> simp [assigned,restored,baseRecovered s d,baseState,
      Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?,h,
      aggregateRet,Inv03.Bodies.tmp,Inv32CeilFlags.h0,operand]
  have target : s.callFinal.lookupLocal? aggregateRet = some (.word x) := by
    rw [cf]; simp [assigned,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  have put : s.callFinal.assignLocal? Inv03.Bodies.tmp (.word x) = some (copiedState s d.base x) := by
    rw [cf]
    cases h : s.baseStart.locals <;> simp [assigned,restored,baseRecovered s d,baseState,copiedState,
      Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.lookup?,LocalEnv.declare,
      Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,h,aggregateRet,Inv03.Bodies.tmp,Inv32CeilFlags.h0,operand]
  have copy := Inv48.CloneGetters.assign (s.sourceN-1) table s.sourceContext s.callFinal
    (copiedState s d.base x) Inv03.Bodies.tmp 0 x (.var aggregateRet) old
    (Inv32Guards.readWord _ _ _ _ _ target) put
  have run := Inv48.CollateralCloneFuel.replayList (Nat.le_add_right (s.sourceN-1) 1) _ _ _ _ _ _ s.copyRun
  rw [Stmt.evalList,copy] at run
  simp only [pure_bind,Stmt.evalList] at run
  exact (pureResult run).1
end Inv48.QuoteMinimumEvents
