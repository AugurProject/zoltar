import Inv48EscrowEntryGenerated
import Inv48EscrowEntryJoin
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
private theorem pb {α β : Type} (x : α) (k : α → SolI β) : pure x >>= k = k x := rfl

/-- The real public FunctionDef entry binds the original arguments and named
return defaults. ABI amount/gas cleanups execute in the certified body prologue. -/
theorem publicEntryTree (fuel : Nat) (c : Context) (state : State)
    (payer sponsor weth amount halt bounty gas : Nat) (zeroValue : c.value = 0) :
    fn.evalBodyEntry fuel Inv48.Source.model.core.table c state
      (arguments payer sponsor weth amount halt bounty gas) =
      some (Stmt.eval fuel Inv48.Source.model.core.table c
        (entry c state payer sponsor weth amount halt bounty gas) fn.body) := by
  have accepts : fn.acceptsValue c.value = true := by
    simp [FunctionDef.acceptsValue,metadata.2.2,zeroValue,wordEq]
  unfold FunctionDef.evalBodyEntry
  rw [accepts,binding fn payer sponsor weth amount halt bounty gas metadata.1 metadata.2.1]
  rfl

/-- Successful full public body execution, assembled from the actual getter
body's explicit response and the actual remaining public statements. The
suffix starts at a fully computed runtime; no live-local premise appears. -/
theorem publicBodyFromLookup (n : Nat) (c : Context) (state : State)
    (response final : Runtime) (payer sponsor weth amount halt bounty gas rep : Nat)
    (hw : weth < 2^256) (ha : amount < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32)
    (self : c.sender = c.self) (selfBound : c.self < 2^256)
    (lookupTrace suffixTrace : Interaction.Transcript)
    (lookup : LookupResponse n Inv48.Source.model.core.table c lookupFn
      (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope)
      response rep lookupTrace)
    (suffix : ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c
      (publicPrepared c state response payer sponsor weth amount halt bounty gas rep)
      (EscrowTrace.actualStatements.drop 4)) suffixTrace (.normal final)) :
    ExecutesOK (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (entry c state payer sponsor weth amount halt bounty gas) fn.body)
      (lookupTrace ++ suffixTrace) (.normal final.popScope.popScope) := by
  let t := Inv48.Source.model.core.table
  let base := entry c state payer sponsor weth amount halt bounty gas
  have prep := prepareExecution n t c base.pushScope response rep lookupFn lookupTrace
    self selfBound lookupFound lookupReturns lookup
  have inner := appendExecution (n+3) t c base.pushScope.pushScope
    (publicPrepared c state response payer sponsor weth amount halt bounty gas rep) final
    preparation (EscrowTrace.actualStatements.drop 4) lookupTrace suffixTrace prep suffix
  rw [← actualPreparation,List.take_append_drop] at inner
  have body := blockExecution (n+3) t c base.pushScope final _ _ inner
  have one : ExecutesOK (Stmt.evalList (n+4) t c base.pushScope
      [.block EscrowTrace.actualStatements]) (lookupTrace ++ suffixTrace) (.normal final.popScope) := by
    rw [Stmt.evalList]
    simpa only [List.append_nil] using Interaction.Executes.bind_ok
      (next := fun out => match out with
        | .normal rr => Stmt.evalList (n+4) t c rr []
        | out => pure out) body
      (show ExecutesOK (Stmt.evalList (n+4) t c final.popScope []) [] (.normal final.popScope) by
        rw [Stmt.evalList]; exact .done _)
  have pro : ExecutesOK (Stmt.evalList (n+4) t c base.pushScope prologue) [] (.normal base.pushScope) := by
    rw [prologueExec (n+3) t c state payer sponsor weth amount halt bounty gas hw ha hh hb hg]
    exact .done _
  have outerRun := appendExecution (n+4) t c base.pushScope base.pushScope final.popScope
    prologue [.block EscrowTrace.actualStatements] [] (lookupTrace ++ suffixTrace) pro one
  rw [bodyDecomposition]
  exact blockExecution (n+4) t c base final.popScope _ _ outerRun

/-- Reify the successful public body as the actual public entry tree. -/
theorem publicEntryFromBody (fuel : Nat) (c : Context) (state : State)
    (payer sponsor weth amount halt bounty gas : Nat) (zeroValue : c.value = 0)
    (trace : Interaction.Transcript) (final : Runtime)
    (body : ExecutesOK (Stmt.eval fuel Inv48.Source.model.core.table c
      (entry c state payer sponsor weth amount halt bounty gas) fn.body) trace (.normal final)) :
    ∃ tree, fn.evalBodyEntry fuel Inv48.Source.model.core.table c state
      (arguments payer sponsor weth amount halt bounty gas) = some tree ∧
      ExecutesOK tree trace (.normal final) := by
  exact ⟨_,publicEntryTree fuel c state payer sponsor weth amount halt bounty gas zeroValue,body⟩

/-- The same trace through the actual public call adapter, including its real
named-return collection/coercion. No pure-call equation is assumed. -/
theorem publicCallExecution (fuel : Nat) (c : Context) (state : State)
    (payer sponsor weth amount halt bounty gas : Nat) (zeroValue : c.value = 0)
    (trace : Interaction.Transcript) (final : Runtime)
    (body : ExecutesOK (Stmt.eval fuel Inv48.Source.model.core.table c
      (entry c state payer sponsor weth amount halt bounty gas) fn.body) trace (.normal final)) :
    ∃ tree, fn.call fuel Inv48.Source.model.core.table c state
      (arguments payer sponsor weth amount halt bounty gas) = some tree ∧
      ExecutesOK tree trace (fn.callBodyResult state (.normal final)) := by
  rw [FunctionDef.call,publicEntryTree fuel c state payer sponsor weth amount halt bounty gas zeroValue]
  refine ⟨_,rfl,?_⟩
  change ExecutesOK (Interaction.map (fn.callBodyResult state)
    (Stmt.eval fuel Inv48.Source.model.core.table c
      (entry c state payer sponsor weth amount halt bounty gas) fn.body)) trace _
  rw [Interaction.map]
  simpa only [List.append_nil] using Interaction.Executes.bind_ok
    (next := fun out => pure (fn.callBodyResult state out)) body
    (show ExecutesOK (pure (fn.callBodyResult state (.normal final))) []
      (fn.callBodyResult state (.normal final)) from .done _)

#print axioms publicCallExecution
#print axioms publicEntryTree
#print axioms publicBodyFromLookup
#print axioms publicEntryFromBody
end Inv48.EscrowEntry
