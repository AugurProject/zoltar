import Inv48ExposureHeapCall
import Inv48QuoteFundingFieldsSource
open SolidCore.Solidity.Source
namespace Inv48.ExposureHeap
open Inv48.CloneRead Inv48.CloneGetters Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 5000000
set_option linter.unusedSimpArgs false

def continued (c : Context) (r : Runtime) (code : List Nat) (u root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) : Runtime :=
  {caller c r code u root exposure out with locals := (r.declareLocal tmp (.word exposure)).locals}

theorem quote_hoist_source : (Inv48.WholeQuote.oracleP[1]).value = hoist aggregateRet aggregateKey := rfl

/-- This exact call occurs in the registered post-funding suffix. -/
theorem actual_suffix_call :
    (Inv48.QuoteMemory.actualStatements.drop 5)[4]? = some (hoist aggregateRet aggregateKey) := by
  rw [Inv48.QuoteFundingFields.actualInterior]
  rfl

/-- Quote-stage capture and copy continuation execute, with exactly one fresh cache allocation. -/
theorem quote_hoist (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat) (root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse)
    (h : OracleResponseAssumptions {c with checked := true} (oracleEntry r) rows
      implementation universeBytes token root exposure out) :
    (Stmt.eval (n+52) table c (r.declareLocal tmp (.word 0))
      (hoist aggregateRet aggregateKey)).runWith rows =
      .ok (.normal (continued {c with checked := true} r
        (runtimeCode implementation universeBytes token) (decode universeBytes) root exposure out)) := by
  let code := runtimeCode implementation universeBytes token
  let u := decode universeBytes
  let cc := {c with checked := true}
  let base := r.declareLocal tmp (.word 0)
  let s := caller cc base.pushScope code u root exposure out
  let next := (continued cc r code u root exposure out).pushScope.declareLocal aggregateRet (.word exposure)
  have call := aggregate_call n c base.pushScope rows implementation universeBytes token root exposure out h
  have run := hoistRun (n+49) c base s next rows aggregateRet aggregateKey exposure call
    (by cases H : r.locals <;> simp [s,base,caller,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,aggregateRet])
    (by cases H : r.locals <;> simp [s,base,caller,Runtime.pushScope,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H])
    (by cases H : r.locals <;> simp [s,next,continued,base,caller,aggregateFinal,oracleNext,oracleEntry,scalarFrame,oracleStage,universeStage,
      Inv48.Minima.wordReply,Inv12.replied,Runtime.recordExternalInteraction,
      Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.popScope,Runtime.withFrame,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,
      H,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,aggregateRet,post,Runtime.allocMemory])
  simpa only [next,Runtime.popScope,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare] using run

theorem continued_memory (c : Context) (r : Runtime) (code : List Nat) (u root exposure id : Nat)
    (out : EvmCompiler.Simulation.CallResponse) (earlier : id < r.nextMemory) :
    (continued c r code u root exposure out).loadMemory? id = r.loadMemory? id :=
  caller_memory c r code u root exposure id out earlier

theorem continued_value (c : Context) (r : Runtime) (code : List Nat) (u root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) :
    (continued c r code u root exposure out).lookupLocal? tmp = some (.word exposure) := by
  cases H : r.locals <;>
    simp [continued,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,
      LocalEnv.lookup?,Frame.lookup?,H]

/-- Exact tuple preservation implies Keeps, without assuming any call frame property. -/
theorem continued_keeps (c : Context) (r : Runtime) (code : List Nat) (u root exposure id a b : Nat)
    (out : EvmCompiler.Simulation.CallResponse) (earlier : id < r.nextMemory)
    (before : Inv48.QuoteTailPreserve.Keeps r id a b) :
    Inv48.QuoteTailPreserve.Keeps (continued c r code u root exposure out) id a b := by
  refine ⟨?_,?_⟩
  · cases H : r.locals <;>
      simpa [continued,caller,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,
        LocalEnv.lookup?,Frame.lookup?,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,H] using before.1
  · obtain ⟨h,e,s,mem⟩ := before.2
    exact ⟨h,e,s,(continued_memory c r code u root exposure id out earlier).trans mem⟩
end Inv48.ExposureHeap
