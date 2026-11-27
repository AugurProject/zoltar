import Inv48RepReturnedMinimumRecover
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RepReturnedMinimum
open Inv48.MinimumSuccessWords Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
abbrev Deployment := Inv48.CollateralCloneStage.Deployment
def bytes (d : Deployment c r) := Inv12.wireBytes 2328446634 [decode d.universeBytes]

theorem startRecovered (s : Joined trace out) (d : Deployment s.context s.caller) :
    s.start = oracleStage (Inv48.RepMinimum.callee s.caller).pushScope.pushScope.pushScope
      (runtimeCode d.implementation d.universeBytes d.token) (decode d.universeBytes) := by
  have run := Inv48.CollateralCloneFuel.replayList (Nat.le_add_right s.n 46) _ _ _ _ _ _ s.prefixRun
  rw [prefixPure s.n s.context (Inv48.RepMinimum.callee s.caller).pushScope.pushScope.pushScope d.implementation d.universeBytes d.token
    d.hi d.hu d.ht d.cu d.ct d.selfFit d.code] at run
  exact Result.normal.inj (Inv48.CollateralReturnedMinimum.pureResult run).2

theorem closeRead (s : Joined trace out) (d : Deployment s.context s.caller)
    (env : CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    ∃ response x, OracleEvent s.context s.start d.root (bytes d) s.during response ∧
      response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x) := by
  have start := startRecovered s d
  have locals : s.start.locals = [[(tmp,.word 0),(view,.word (decode d.universeBytes)),
      (tmp,.word (decode d.universeBytes))],[],[],[("_ret0",.word 0)]] := by
    rw [start]
    simp [oracleStage,universeStage,Inv48.RepMinimum.callee,post,Runtime.allocMemory,
      Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare]
  have source : s.start.lookupLocal? view = some (.word (decode d.universeBytes)) := by
    simp [Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,locals,view,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0]
  have world : s.start.state = s.caller.state := by rw [start]; rfl
  have root := Inv48.Minima.immutableRead s.context s.start "securityPool" d.field d.root d.found
    (by rw [world]; exact d.stored) d.coercion
  have run := Inv48.CollateralCloneFuel.replay (Nat.le_add_right s.n 2) _ _ _ _ _ _ s.read
  obtain ⟨response,x,rest,event,success,fit,decoded,X⟩ := decodedRead s.n s.context s.start s.final
    s.during (decode d.universeBytes) d.root source (universe_bounds _ d.hu d.cu)
    locals root d.rootFit d.away env run
  exact ⟨response,x,⟨rest,event⟩,success,fit,decoded,X⟩

def tailState (r : Runtime) (x : Nat) :=
  Inv32OneArg.store (r.declareLocal "#view47476" (.word x)) Inv03.Bodies.tmp (Inv03.ceilQuot x 100)

theorem returnedMinimum (s : Joined trace out) (x : Nat) (fit : x < Inv32Division.R)
    (X : s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) :
    s.value = .returned (tailState s.final x) [.word (Inv03.ceilQuot x 100)] ∧ s.tail = [] ∧
    Inv03.ceilQuot x 100 < Inv32Division.R := by
  have run := Inv48.CollateralCloneFuel.replayList (Nat.le_add_right s.n 16) _ _ _ _ _ _ s.tailRun
  have generated := Inv48.Minima.generatedRepTail s.n s.context s.final x fit X
  rw [generated] at run
  have result := Inv48.CollateralReturnedMinimum.pureResult run
  have recovered := repTailRecovered s.n s.context s.final (tailState s.final x) x
    [.word (Inv03.ceilQuot x 100)] s.tail fit X
    (by simpa only [result.2] using
      (Inv48.CollateralCloneFuel.replayList (Nat.le_add_right s.n 16) _ _ _ _ _ _ s.tailRun))
  exact ⟨result.2,result.1,recovered.1⟩

theorem callerAssignment (s : Joined trace out) (x : Nat) (fit : x < Inv32Division.R)
    (X : s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) :
    ({ (tailState s.final x).popScope.popScope.popScope with locals := s.saved }).assignNamedValuesRef?
      [Inv48.Positive.ret2] [.word (Inv03.ceilQuot x 100)] = some s.publicFinal ∧ s.finishTrace = [] := by
  have result := returnedMinimum s x fit X
  have run := s.finishRun
  rw [result.1] at run
  have finish : internalCallFinish s.fn [Inv48.Positive.ret2] s.saved
      (((Result.returned (tailState s.final x) [.word (Inv03.ceilQuot x 100)]).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope |>.mapRuntime Runtime.popScope) =
      internalCallAssign { (tailState s.final x).popScope.popScope.popScope with locals := s.saved }
        [Inv48.Positive.ret2] [.word (Inv03.ceilQuot x 100)] := by
    simp [Result.mapRuntime,internalCallFinish,s.returns,coerceReturnBindingsRef,
      coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,Bind.bind,Except.bind]
  rw [finish,internalCallAssign] at run
  simp only [List.isEmpty,Bool.false_eq_true,if_false] at run
  split at run
  · rename_i updated eq
    have pure := Inv48.CollateralReturnedMinimum.pureResult run
    exact ⟨by rw [eq,← Result.normal.inj pure.2],pure.1⟩
  · have impossible := (Inv48.CollateralReturnedMinimum.pureResult run).2
    cases impossible
end Inv48.RepReturnedMinimum
