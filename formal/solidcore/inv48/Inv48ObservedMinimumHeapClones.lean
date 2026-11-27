import Inv48ObservedMinimumHeapBody
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.CollateralCloneStage Inv48.CollateralMinimum Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
theorem collateralRead (s : Slice trace out) (d : Deployment s.context s.caller)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    ∃ response x rest,
      s.during = {query := (.external (snapshotWorld s.context s.start.state)
        (.call (buildCallRequest s.context .staticcall d.root (bytes d) 0 none))),answer := response} :: rest ∧
      response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x) ∧
      s.final.memory = s.start.memory ∧ s.final.nextMemory = s.start.nextMemory := by
  have f := Inv48.CollateralCloneFuel.facts s d
  have b := Inv48.CollateralCloneFuel.bindings s d
  have run := Inv48.CollateralCloneFuel.replay (Nat.le_add_right s.n 2) _ _ _ _ _ _ s.read
  exact Inv48.ObservedMinimumHeap.CollateralCloneStage.decodedRead s.n s.context s.start s.final s.during (decode d.universeBytes) d.root
    f.sourceLocal (universe_bounds _ d.hu d.cu) f.locals b.2 d.rootFit d.away env run

open Inv48.RepReturnedMinimum Inv48.CloneGetters Inv48.MinimumSuccessWords
theorem repRead (s : Joined trace out) (d : Inv48.RepReturnedMinimum.Deployment s.context s.caller)
    (env : CanonicalOracle s.context s.start d.root (Inv48.RepReturnedMinimum.bytes d) s.during) :
    ∃ response x, OracleEvent s.context s.start d.root (Inv48.RepReturnedMinimum.bytes d) s.during response ∧
      response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x) ∧
      s.final.memory = s.start.memory ∧ s.final.nextMemory = s.start.nextMemory := by
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
  obtain ⟨response,x,rest,event,success,fit,decoded,X,mem,next⟩ := Inv48.ObservedMinimumHeap.RepReturnedMinimum.decodedRead s.n s.context s.start s.final
    s.during (decode d.universeBytes) d.root source (universe_bounds _ d.hu d.cu)
    locals root d.rootFit d.away env run
  exact ⟨response,x,⟨rest,event⟩,success,fit,decoded,X,mem,next⟩
end Inv48.ObservedMinimumHeap
