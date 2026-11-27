import Inv48QuoteMinimumEventsRepRead
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteMinimumEvents
open Inv48.MinimumSuccessWords Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters Inv48.RepReturnedMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
theorem repReadEvents (s : Joined trace out) (d : Deployment s.context s.caller)
    (env : CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    ∃ response x, s.during = [{query := (.external (snapshotWorld s.context s.start.state)
      (.call (buildCallRequest s.context .staticcall d.root (bytes d) 0 none))), answer := response}] ∧
      response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x) := by
  have start := startRecovered s d
  have locals : s.start.locals = [[(tmp,.word 0),(view,.word (decode d.universeBytes)),
      (tmp,.word (decode d.universeBytes))],[],[],[("_ret0",.word 0)]] := by
    rw [start]
    simp [Inv48.RepReturnedMinimum.oracleStage,universeStage,Inv48.RepMinimum.callee,post,Runtime.allocMemory,
      Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare]
  have source : s.start.lookupLocal? view = some (.word (decode d.universeBytes)) := by
    simp [Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,locals,view,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0]
  have world : s.start.state = s.caller.state := by rw [start]; rfl
  have root := Inv48.Minima.immutableRead s.context s.start "securityPool" d.field d.root d.found
    (by rw [world]; exact d.stored) d.coercion
  have run := Inv48.CollateralCloneFuel.replay (Nat.le_add_right s.n 2) _ _ _ _ _ _ s.read
  obtain ⟨response,x,rest,event,empty,success,fit,decoded,X⟩ := repReadSingleton s.n s.context s.start s.final
    s.during (decode d.universeBytes) d.root source (universe_bounds _ d.hu d.cu)
    locals root d.rootFit d.away env run
  exact ⟨response,x,by simpa [empty] using event,success,fit,decoded,X⟩

/-- Includes the entire clone getter, actual oracle ABI decode, arithmetic return,
three scope pops, return coercion and assignment to the original caller. -/
theorem repHelperEvents (s : Joined trace out) (d : Deployment s.context s.caller)
    (env : CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    ∃ response x,
      s.prefixTrace ++ (s.during ++ (s.tail ++ s.finishTrace)) =
        [{query := (.external (snapshotWorld s.context s.start.state)
          (.call (buildCallRequest s.context .staticcall d.root (bytes d) 0 none))), answer := response}] ∧
      response.success = true ∧ x < Inv32Division.R ∧
      Inv48.ExposureComparison.decoded response x ∧
      s.value = .returned (tailState s.final x) [.word (Inv03.ceilQuot x 100)] ∧
      ({ (tailState s.final x).popScope.popScope.popScope with locals := s.saved }).assignNamedValuesRef?
        [Inv48.Positive.ret2] [.word (Inv03.ceilQuot x 100)] = some s.publicFinal := by
  obtain ⟨response,x,event,success,fit,decoded,X⟩ := repReadEvents s d env
  have preRun := Inv48.CollateralCloneFuel.replayList (Nat.le_add_right s.n 46) _ _ _ _ _ _ s.prefixRun
  rw [prefixPure s.n s.context (Inv48.RepMinimum.callee s.caller).pushScope.pushScope.pushScope
    d.implementation d.universeBytes d.token d.hi d.hu d.ht d.cu d.ct d.selfFit d.code] at preRun
  have empty := (Inv48.CollateralReturnedMinimum.pureResult preRun).1
  have returned := returnedMinimum s x fit X
  have assigned := callerAssignment s x fit X
  exact ⟨response,x,by rw [empty,event,returned.2.1,assigned.2]; rfl,
    success,fit,decoded,returned.1,assigned.1⟩
end Inv48.QuoteMinimumEvents
