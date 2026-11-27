import Inv48QuoteMinimumEventsCollateralPure
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteMinimumEvents
open Inv48.CollateralCloneFuel Inv48.CollateralCloneStage Inv48.CollateralMinimum Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem collateralReadEvents (s : Slice trace out) (d : Deployment s.context s.caller)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    ∃ response x rest,
      s.during = {query := (.external (snapshotWorld s.context s.start.state)
        (.call (buildCallRequest s.context .staticcall d.root (bytes d) 0 none))),answer := response} :: rest ∧
      rest = [] ∧ response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x) := by
  have f := Inv48.CollateralCloneFuel.facts s d
  have b := Inv48.CollateralCloneFuel.bindings s d
  have run := replay (Nat.le_add_right s.n 2) _ _ _ _ _ _ s.read
  exact collateralReadSingleton s.n s.context s.start s.final s.during (decode d.universeBytes) d.root
    f.sourceLocal (universe_bounds _ d.hu d.cu) f.locals b.2 d.rootFit d.away env run

/-- Every retained slice of the full collateral helper is included. -/
theorem collateralHelperEvents (s : Inv48.CollateralReturnedMinimum.Joined trace out)
    (d : Deployment s.context s.caller) (b : Inv48.CollateralReturnedMinimum.BaseDeployment s)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    ∃ response x,
      s.baseTrace ++ (s.prefixTrace ++ (s.during ++ (s.oracleTail ++ (s.aggregateFinish ++
        (s.copyTail ++ (s.sourceTail ++ s.collateralFinish)))))) =
      [{query := (.external (snapshotWorld s.context s.start.state)
        (.call (buildCallRequest s.context .staticcall d.root (bytes d) 0 none))),answer := response}] ∧
      response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      b.base + Inv03.ceilQuot x 100 < Inv32Division.R ∧
      s.sourceValue = .returned (Inv48.Minima.tailState s.tailStart x b.base)
        [.word (b.base + Inv03.ceilQuot x 100)] := by
  obtain ⟨response,x,rest,event,empty,success,fit,decoded,X⟩ := collateralReadEvents s.toSlice d env
  have base := (collateralBaseEvents s b).1
  have pre := (Inv48.CollateralCloneFuel.facts s.toSlice d).prefixEmpty
  have ret := Inv48.CollateralReturnedMinimum.aggregateReturn s x fit X
  have finish := (collateralFinishEvents s b x fit X).1
  have copy := collateralCopyEvents s b x fit X
  have tail := Inv48.CollateralReturnedMinimum.returnedMinimum s b x fit X
  have assigned := Inv48.CollateralReturnedMinimum.callerAssignment s b x fit X
  exact ⟨response,x,by rw [base,pre,event,empty,ret.2,finish,copy,tail.2.2,assigned.2]; rfl,
    success,fit,decoded,tail.1,tail.2.1⟩
end Inv48.QuoteMinimumEvents
