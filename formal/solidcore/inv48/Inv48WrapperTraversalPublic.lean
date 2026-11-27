import Inv48WrapperTraversalRaw
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem occurs (b : Blocks t target fuel stmt) : Occurs target stmt := by
  induction b with
  | here => exact .here
  | capture n names body next ih => exact .capture names body ih
  | block n xs child ys safe next ih =>
    exact .block (xs++child::ys) child (by simp) ih

/-- Strengthens the source-only `FundingFallthrough.bothWrapperSites`: each
wrapper's certified literal occurrence is recovered from the whole wrapper
execution, rather than supplied as an independently successful invocation. -/
theorem bothWrapperSites (name : String) (wrapper : FunctionDef) (member : name ∈ wrappers)
    (wrapperRegistered : Inv48.Source.model.core.findFunctionByName? name = some wrapper)
    (fn : InternalFunction) (registered : request = some fn) :
    ∃ p : Plan Inv48.Source.model.core.table wrapper.body,
      plan 100 Inv48.Source.model.core.table wrapper.body = some p ∧
      Occurs (.internalCall p.targets Inv48.RequestQuote.requestKey p.args) wrapper.body ∧
      ∀ (n : Nat) (c : Context) (r : Runtime) (trace : Interaction.Transcript) (out : Result),
        (¬ Escapes out) →
        Interaction.Executes (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body)
          trace (.ok out) →
        Recovered (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body)
          p.targets p.args trace out (n+4) ∧
        Nonempty (Site (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body)
          Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out) := by
  obtain ⟨p,found⟩ := wrapperPlan name wrapper member wrapperRegistered
  exact ⟨p,found,occurs (p.build 4),fun n c r trace out ordinary run =>
    ⟨invocation wrapper p n c r trace out ordinary run,
      quote wrapper p fn registered n c r trace out ordinary run⟩⟩
theorem bothRawQuote (name : String) (wrapper : FunctionDef) (member : name ∈ wrappers)
    (wrapperRegistered : Inv48.Source.model.core.findFunctionByName? name = some wrapper)
 :
    ∃ p : Plan Inv48.Source.model.core.table wrapper.body,
      plan 100 Inv48.Source.model.core.table wrapper.body = some p ∧
    ∀ (fn : InternalFunction) (registered : request = some fn) (n : Nat)
    (base : Context) (state : State) (self sender value : Nat) (data : List Byte)
    (selector : Nat) (args : List Value)
    (read : ABI.readSelector? data = some selector)
    (selected : Inv48.Source.model.core.findFunctionBySelector? selector = some wrapper)
    (decoded : ABI.decodeFunctionArgs? wrapper (data.drop ABI.selectorBytes) = .ok args)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+4+p.depth) Inv48.Source.model.core
      base state self sender value data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true),
    ∃ entryRuntime result,
      finish Inv48.Source.model.core wrapper state result = .ok out ∧
      Interaction.Executes (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) trace (.ok result) ∧
      Recovered (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) p.targets p.args trace result (n+4) ∧
      Nonempty (Site (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
        entryRuntime wrapper.body) Inv48.Source.model.core.table
        Inv48.RequestQuote.quoteCaptureP.value trace result) := by
  obtain ⟨p,found⟩ := wrapperPlan name wrapper member wrapperRegistered
  exact ⟨p,found,rawQuote name wrapper member wrapperRegistered p⟩
end Inv48.WrapperTraversal
