import Inv48EscrowEntryPublic
import Inv48EscrowEntryGuard
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

theorem treeOfEmpty {α : Type} (tree : SolI α) (value : α)
    (run : ExecutesOK tree [] value) : tree = pure value := by
  cases run
  rfl

theorem singletonNormal (fuel : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (s : Stmt) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList fuel t c r [s]) trace (.normal final)) :
    ExecutesOK (Stmt.eval fuel t c r s) trace (.normal final) := by
  obtain ⟨middle,before,after,joined,step,rest⟩ := sequenceNormal _ _ _ _ _ _ _ _ run
  rw [Stmt.evalList] at rest
  have h := pureResult _ _ _ rest
  cases h.2
  have traceEq : trace = before := by simpa only [h.1,List.append_nil] using joined
  exact traceEq.symm ▸ step

/-- Invert an actual successful public entry. The local clone getter response
has an empty transcript; its pure tree is DERIVED from that execution, never
assumed. All pre-constructor locals and the self-only condition are derived. -/
theorem suffixFromSuccessfulEntry (n : Nat) (c : Context) (state : State)
    (response final : Runtime) (payer sponsor weth amount halt bounty gas rep : Nat)
    (hw : weth < 2^256) (ha : amount < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32)
    (senderBound : c.sender < 2^256) (selfBound : c.self < 2^256) (zeroValue : c.value = 0)
    (lookup : LookupResponse n Inv48.Source.model.core.table c lookupFn
      (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope)
      response rep [])
    (tree : SolI Result) (trace : Interaction.Transcript)
    (binding : fn.evalBodyEntry (n+5) Inv48.Source.model.core.table c state
      (arguments payer sponsor weth amount halt bounty gas) = some tree)
    (run : ExecutesOK tree trace (.normal final)) :
    c.sender = c.self ∧ ∃ rawFinal,
      final = rawFinal.popScope.popScope ∧
      ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c
        (publicPrepared c state response payer sponsor weth amount halt bounty gas rep)
        (EscrowTrace.actualStatements.drop 4)) trace (.normal rawFinal) := by
  rw [publicEntryTree (n+5) c state payer sponsor weth amount halt bounty gas zeroValue] at binding
  cases binding
  rw [bodyDecomposition] at run
  let t := Inv48.Source.model.core.table
  let base := entry c state payer sponsor weth amount halt bounty gas
  obtain ⟨outerEnd,outerRun,outerPop⟩ := blockNormal (n+4) t c base final _ trace run
  obtain ⟨scopedRuntime,proTrace,innerTrace,joined,proRun,oneRun⟩ :=
    appendNormal (n+4) t c base.pushScope outerEnd prologue
      [.block EscrowTrace.actualStatements] trace outerRun
  rw [prologueExec (n+3) t c state payer sponsor weth amount halt bounty gas hw ha hh hb hg] at proRun
  have proResult := pureResult _ _ _ proRun
  have scopedEq : scopedRuntime = base.pushScope := Result.normal.inj proResult.2
  subst scopedRuntime
  have traceEq : trace = innerTrace := by simpa only [proResult.1,List.nil_append] using joined
  have blockRun := singletonNormal (n+4) t c base.pushScope outerEnd
    (.block EscrowTrace.actualStatements) innerTrace oneRun
  obtain ⟨rawFinal,innerRun,innerPop⟩ := blockNormal (n+3) t c base.pushScope outerEnd _ innerTrace blockRun
  rw [← List.take_append_drop 4 EscrowTrace.actualStatements,actualPreparation] at innerRun
  obtain ⟨ready,prepTrace,suffixTrace,innerJoined,prepRun,suffixRun⟩ :=
    appendNormal (n+3) t c base.pushScope.pushScope rawFinal preparation
      (EscrowTrace.actualStatements.drop 4) innerTrace innerRun
  have prepCopy := prepRun
  unfold preparation at prepCopy
  obtain ⟨guardEnd,guardTrace,_,_,guardRun,_⟩ := sequenceNormal _ _ _ _ _ _ _ _ prepCopy
  obtain ⟨self,_,_⟩ := selfGuardSuccessful (n+2) t c base.pushScope.pushScope guardEnd
    senderBound selfBound guardTrace guardRun
  have preparedRun := prepareExecution n t c base.pushScope response rep lookupFn []
    self selfBound lookupFound lookupReturns lookup
  have preparedTree := treeOfEmpty _ _ preparedRun
  rw [preparedTree] at prepRun
  have prepResult := pureResult _ _ _ prepRun
  have readyEq : ready = publicPrepared c state response payer sponsor weth amount halt bounty gas rep :=
    Result.normal.inj prepResult.2
  subst ready
  have suffixTraceEq : trace = suffixTrace := by
    rw [traceEq,innerJoined,prepResult.1,List.nil_append]
  refine ⟨self,rawFinal,?_,?_⟩
  · rw [outerPop,innerPop]
  · exact suffixTraceEq.symm ▸ suffixRun

#print axioms treeOfEmpty
#print axioms singletonNormal
#print axioms suffixFromSuccessfulEntry
end Inv48.EscrowEntry
