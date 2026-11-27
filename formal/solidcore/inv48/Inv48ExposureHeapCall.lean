import Inv48ExposureHeapCore
open SolidCore.Solidity.Source
namespace Inv48.ExposureHeap
open Inv48.CloneRead Inv48.CloneGetters Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 5000000
set_option linter.unusedSimpArgs false

def caller (c : Context) (r : Runtime) (code : List Nat) (u root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) : Runtime :=
  {aggregateFinal (oracleNext c r code u root exposure out) with
    locals := (r.declareLocal aggregateRet (.word exposure)).locals}

/-- Executes the actual aggregate internal call, including the real external read.
Only environmental response facts are premises; no heap or assignment success is assumed. -/
theorem aggregate_call (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat) (root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse)
    (h : OracleResponseAssumptions {c with checked := true} (oracleEntry r) rows
      implementation universeBytes token root exposure out) :
    (Stmt.eval (n+50) table c (r.declareLocal aggregateRet (.word 0))
      (.internalCall [aggregateRet] aggregateKey [])).runWith rows =
      .ok (.normal (caller {c with checked := true} r
        (runtimeCode implementation universeBytes token) (decode universeBytes) root exposure out)) := by
  let code := runtimeCode implementation universeBytes token
  let u := decode universeBytes
  let cc := {c with checked := true}
  let next := oracleNext cc r code u root exposure out
  have hs : OracleAssumptions cc (oracleEntry r) next rows implementation universeBytes token root exposure out :=
    ⟨h.hi,h.hu,h.ht,h.cu,h.ct,h.selfWord,h.boundary,h.rootValue,h.exposureFits,h.rootFits,
      h.away,h.success,h.answer,h.decoded,concrete_written cc r code u root exposure out,
      concrete_captured cc r code u root exposure out⟩
  apply aggregateCallRun n c (r.declareLocal aggregateRet (.word 0)) next _ rows aggregateRet
    implementation universeBytes token root exposure out hs
  cases H : r.locals <;>
    simp [caller,aggregateFinal,oracleNext,oracleEntry,scalarFrame,oracleStage,universeStage,
      Inv48.Minima.wordReply,Inv12.replied,Runtime.recordExternalInteraction,
      Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,
      Runtime.lookupLocal?,Runtime.lookupMemoryRef?,LocalEnv.lookup?,Frame.lookup?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?,Runtime.declareLocal,
      Runtime.pushScope,Runtime.popScope,Runtime.withFrame,LocalEnv.declare,H,
      aggregateRet,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,universeView,post,Runtime.allocMemory,
      next,cc,code,u]

/-- Exact old-cell preservation follows from the derived fresh allocation. -/
theorem caller_memory (c : Context) (r : Runtime) (code : List Nat) (u root exposure id : Nat)
    (out : EvmCompiler.Simulation.CallResponse) (earlier : id < r.nextMemory) :
    (caller c r code u root exposure out).loadMemory? id = r.loadMemory? id := by
  change (r.allocMemory (.bytes code)).1.loadMemory? id = r.loadMemory? id
  exact allocation_before r _ id earlier

theorem caller_keeps (c : Context) (r : Runtime) (code : List Nat) (u root exposure id a b : Nat)
    (out : EvmCompiler.Simulation.CallResponse) (earlier : id < r.nextMemory)
    (before : Inv48.QuoteTailPreserve.Keeps r id a b) :
    Inv48.QuoteTailPreserve.Keeps (caller c r code u root exposure out) id a b := by
  refine ⟨?_,?_⟩
  · cases H : r.locals <;>
      simpa [caller,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,
        LocalEnv.lookup?,Frame.lookup?,aggregateRet,H] using before.1
  · obtain ⟨h,e,s,mem⟩ := before.2
    exact ⟨h,e,s,(caller_memory c r code u root exposure id out earlier).trans mem⟩

theorem caller_allocation (c : Context) (r : Runtime) (code : List Nat) (u root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) :
    (caller c r code u root exposure out).nextMemory = r.nextMemory+1 ∧
    (caller c r code u root exposure out).nextMemoryByte = r.nextMemoryByte+(.bytes code : Value).memoryAllocationBytes ∧
    (caller c r code u root exposure out).loadMemory? r.nextMemory = some (.bytes code) := by
  simp [caller,aggregateFinal,oracleNext,oracleEntry,scalarFrame,oracleStage,universeStage,
    Inv48.Minima.wordReply,Inv12.replied,Runtime.recordExternalInteraction,
    Runtime.withFrame,Runtime.declareLocal,Runtime.pushScope,Runtime.popScope,LocalEnv.declare,
    post,Runtime.allocMemory,Runtime.loadMemory?,MemoryMap.lookup?,MemoryMap.insertLoop]
end Inv48.ExposureHeap
