import Inv48QuoteMinimumEventsEntry
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteMinimumEvents
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Invert the reached quote minimum call, including its own argument evaluation,
registered getter entry, body, and real finish. -/
theorem minimumEntered (fuel : Nat) (c : Context) (r final : Runtime)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c r minimumCall)
      trace (.ok (.normal final))) :
    ∃ n fn values argFinal inner saved value argsTrace bodyTrace finishTrace,
      fuel = n+1 ∧ Inv48.Source.model.core.table.lookup? Inv48.QuoteMinimumJoin.key = some fn ∧
      fn.body = Inv48.Public.body ∧ internalCallEnter? fn values argFinal = some (inner,saved) ∧
      trace = argsTrace ++ (bodyTrace ++ finishTrace) ∧
      Interaction.Executes (Expr.evalRefArgList c r [.var Inv32OneArg.argName]).caught
        argsTrace (.ok (.ok (values,argFinal))) ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {c with checked := true}
        inner Inv48.Public.body) bodyTrace (.ok value) ∧
      Interaction.Executes (internalCallFinish fn [Inv48.QuoteMinimumJoin.ret] saved value)
        finishTrace (.ok (.normal final)) ∧ ¬ Escapes value := by
  cases fuel with
  | zero => rw [minimumCall,Stmt.eval] at run; cases run
  | succ n =>
    rw [minimumCall,Stmt.eval] at run
    change Interaction.Executes ((Expr.evalRefArgList c r [.var Inv32OneArg.argName]).caught >>=
      callNext n Inv48.Source.model.core.table c r [Inv48.QuoteMinimumJoin.ret]
        Inv48.QuoteMinimumJoin.key) trace (.ok (.normal final)) at run
    obtain ⟨argResult,argTrace,rest,sp,args,last⟩ := bindSuccess _ _ _ _ run
    cases argResult with
    | error err => simp only [callNext] at last; cases last
    | ok pair =>
      obtain ⟨values,argFinal⟩ := pair
      obtain ⟨fn,found,_,_,body⟩ := Inv48.QuoteMinimumJoin.getterBinding
      cases entered : internalCallEnter? fn values argFinal with
      | none => simp only [callNext,found,entered] at last; cases last
      | some pair =>
        obtain ⟨inner,saved⟩ := pair
        simp only [callNext,found,entered] at last
        change Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {c with checked := true}
          inner fn.body >>= internalCallFinish fn [Inv48.QuoteMinimumJoin.ret] saved)
          rest (.ok (.normal final)) at last
        obtain ⟨value,bt,ft,sp2,exec,finish⟩ := bindSuccess _ _ _ _ last
        refine ⟨n,fn,values,argFinal,inner,saved,value,argTrace,bt,ft,rfl,found,body,entered,
          sp.trans (congrArg (fun t => argTrace++t) sp2),args,?_,finish,?_⟩
        · rwa [body] at exec
        · cases value <;> simp [Escapes]
          all_goals simp only [internalCallFinish] at finish; cases finish

/-- Both helper witnesses descend from this retained minimum body. Increasing
fuel replays its successful path and preserves its transcript and result. -/
theorem retainedHelpers (fuel : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      trace (.ok out)) :
    ∃ collateral : Inv48.CollateralReturnedMinimum.Joined trace out,
    ∃ rep : Inv48.RepReturnedMinimum.Joined trace out,
      (∀ (d : Inv48.CollateralCloneStage.Deployment collateral.context collateral.caller)
         (b : Inv48.CollateralReturnedMinimum.BaseDeployment collateral),
        Inv48.MinimumSuccessWords.CanonicalOracle collateral.context collateral.start d.root
          (Inv48.CollateralCloneStage.bytes d) collateral.during →
        ∃ response x,
          collateral.baseTrace ++ (collateral.prefixTrace ++ (collateral.during ++
            (collateral.oracleTail ++ (collateral.aggregateFinish ++ (collateral.copyTail ++
              (collateral.sourceTail ++ collateral.collateralFinish)))))) =
            [{query := (.external (snapshotWorld collateral.context collateral.start.state)
              (.call (buildCallRequest collateral.context .staticcall d.root
                (Inv48.CollateralCloneStage.bytes d) 0 none))),answer := response}] ∧
          response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
          b.base + Inv03.ceilQuot x 100 < Inv32Division.R ∧
          collateral.sourceValue = .returned (Inv48.Minima.tailState collateral.tailStart x b.base)
            [.word (b.base + Inv03.ceilQuot x 100)]) ∧
      (∀ (d : Inv48.RepReturnedMinimum.Deployment rep.context rep.caller),
        Inv48.MinimumSuccessWords.CanonicalOracle rep.context rep.start d.root
          (Inv48.RepReturnedMinimum.bytes d) rep.during →
        ∃ response x,
          rep.prefixTrace ++ (rep.during ++ (rep.tail ++ rep.finishTrace)) =
            [{query := (.external (snapshotWorld rep.context rep.start.state)
              (.call (buildCallRequest rep.context .staticcall d.root
                (Inv48.RepReturnedMinimum.bytes d) 0 none))),answer := response}] ∧
          response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
          rep.value = .returned (Inv48.RepReturnedMinimum.tailState rep.final x) [.word (Inv03.ceilQuot x 100)] ∧
          ({ (Inv48.RepReturnedMinimum.tailState rep.final x).popScope.popScope.popScope with locals := rep.saved }).assignNamedValuesRef?
            [Inv48.Positive.ret2] [.word (Inv03.ceilQuot x 100)] = some rep.publicFinal) := by
  have replay := Inv48.CollateralCloneFuel.replay (Nat.le_add_right fuel 5) _ _ _ _ _ _ run
  have first := Inv48.MinimumSuccessInvert.normalHelper _ _ _
    (Inv48.MinimumSuccessInvert.firstRoute (fuel+1)) c r trace out ordinary replay
  have second := Inv48.MinimumSuccessInvert.normalHelper _ _ _
    (Inv48.MinimumSuccessInvert.secondRoute (fuel+1)) c r trace out ordinary replay
  obtain ⟨collateral⟩ := Inv48.CollateralReturnedMinimum.recover _ _ _ _ _
    (Inv48.MinimumCollateralTrace.completedList _ _ _ _ _ (Inv48.MinimumSuccessWords.completedBody first))
  obtain ⟨rep⟩ := Inv48.RepReturnedMinimum.recover (Inv48.MinimumSuccessWords.completedBody second)
  exact ⟨collateral,rep,fun d b env => collateralHelperEvents collateral d b env,
    fun d env => repHelperEvents rep d env⟩
end Inv48.QuoteMinimumEvents
