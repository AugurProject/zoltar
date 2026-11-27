import Inv48CollateralCloneFuelInduction
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneFuel
open Inv48.CollateralCloneStage Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- Identify the original prefix result by replaying its successful path at
s.n + 46 and comparing with the canonical pure evaluator certificate. -/
theorem facts (s : Slice trace out) (d : Deployment s.context s.caller) : Facts s d := by
  have entry := s.entry
  have inner : s.inner = scalarFrame s.caller := by
    simpa [internalCallEnter?,InternalFunction.initialFrame?,aggregateFn,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,
      Ty.defaultValue,scalarFrame] using (congrArg (Option.map Prod.fst) entry).symm
  have run := replayList (Nat.le_add_right s.n 46) _ _ _ _ _ _ s.prefixRun
  rw [inner,prefixPure s.n s.context (scalarFrame s.caller).pushScope.pushScope.pushScope d.implementation d.universeBytes d.token
    d.hi d.hu d.ht d.cu d.ct d.selfFit d.code] at run
  have pureResult {a : Result} {tr : Interaction.Transcript} {b : Result}
      (h : Interaction.Executes (pure a : SolI Result) tr (.ok b)) : tr = [] ∧ b = a := by
    cases h
    exact ⟨rfl,rfl⟩
  obtain ⟨empty,same⟩ := pureResult run
  have start : s.start = oracleStage (scalarFrame s.caller).pushScope.pushScope.pushScope
      (runtimeCode d.implementation d.universeBytes d.token) (decode d.universeBytes) := Result.normal.inj same
  constructor
  · exact empty
  · rw [start]
    simp [oracleStage,universeStage,Inv48.ExposureHeap.oracleEntry,scalarFrame,post,
      Runtime.allocMemory,Runtime.declareLocal,LocalEnv.declare,Runtime.pushScope,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,tmp,Inv03.Bodies.tmp,
      Inv32CeilFlags.h0,universeView]
  · rw [start]
    simp [oracleStage,universeStage,scalarFrame,post,Runtime.allocMemory,
      Runtime.declareLocal,LocalEnv.declare,Runtime.pushScope]
  · rw [start]; rfl
  · rw [start]; rfl
  · rw [start]; rfl
  · rw [start]
    simpa [oracleStage,universeStage,Runtime.declareLocal,Runtime.pushScope,scalarFrame] using
      canonical_memory_bytes s.caller d.implementation d.universeBytes d.token d.hi d.hu d.ht
  · rw [start]
    simp [oracleStage,universeStage,scalarFrame,post,Runtime.allocMemory,
      Runtime.declareLocal,Runtime.pushScope,Runtime.loadMemory?,MemoryMap.lookup?,MemoryMap.insertLoop]

end Inv48.CollateralCloneFuel
