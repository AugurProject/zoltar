import Inv48ObservedMinimumHeapTail
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.Positive Inv48.MinimumOperandTransport Inv48.MinimumSuffixPath
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

structure Body (n : Nat) (c : Context) (base : Runtime) (p : Nat)
    (trace : Interaction.Transcript) (out : Result) where
  observed : Inv48.FundingMinimumObserved.Body n c base p trace out
  memory : observed.collateral.joined.baseStart.memory = observed.collateral.cut.caller.memory
  repCaller : observed.rep.joined.caller = observed.rep.stage.cut.caller
  nextMemory : observed.collateral.joined.baseStart.nextMemory = observed.collateral.cut.caller.nextMemory

/-- Recover the omitted callee-entry heap provenance from the reached call.
The new observation retains the original path and transcripts. -/
theorem recover (s : Inv48.FundingMinimumObserved.Body n c base p trace out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (Inv48.Positive.start base p) Inv48.Public.body) trace (.ok out)) :
    Nonempty (Body n c base p trace out) := by
  obtain ⟨site,runtimeEq,_,_,split,entered,last⟩ := completedCollateral s.path s.collateral.cut run
  obtain ⟨joined,finalEq,savedEq,mem,next⟩ := joinedAt site s.collateral.cut.callFinal
    s.collateral.cut.callTrace _ split entered last
  let collateral : Collateral s.path := ⟨s.collateral.cut,joined,finalEq,by rwa [runtimeEq] at savedEq⟩
  obtain ⟨siteR,runtimeR,splitR,enteredR,lastR⟩ := Inv48.MinimumRepOperand.completed s.path s.rep.stage run
  obtain ⟨joinedR,finalR,savedR,callerR⟩ := repJoinedAt siteR s.rep.stage.cut.callFinal
    s.rep.stage.cut.callTrace _ splitR enteredR lastR
  let rep : Inv48.MinimumRepOperand.Rep s.path := ⟨s.rep.stage,joinedR,finalR,by rwa [runtimeR] at savedR⟩
  exact ⟨⟨⟨s.path,collateral,rep,s.rounded,s.positive⟩,by simpa [collateral,runtimeEq] using mem,
    by simpa [rep,runtimeR] using callerR,
    by simpa [collateral,runtimeEq] using next⟩⟩
end Inv48.ObservedMinimumHeap
