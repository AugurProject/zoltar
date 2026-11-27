import Inv48ObservedMinimumHeapRecovery
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.CollateralReturnedMinimum Inv48.CollateralCloneStage Inv48.CollateralMinimum Inv48.Minima
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
theorem tailOperands (s : Joined trace out) (d : BaseDeployment s) (x : Nat)
    (fit : x < Inv32Division.R)
    (X : s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) :
    s.tailStart.memory = s.final.memory ∧ s.tailStart.nextMemory = s.final.nextMemory := by
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
  have eq := Result.normal.inj (pureResult run).2
  rw [s.popEq,eq]
  exact ⟨rfl,rfl⟩
end Inv48.ObservedMinimumHeap
