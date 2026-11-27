import Inv48WrapperArgsDecode
import Inv48WrapperArgsEntry
import Inv48WrapperArgsLoop
import Inv48WrapperArgsBindings
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem bothRawQuoteWithArgs (name : String) (wrapper : FunctionDef) (member : name ∈ wrappers)
    (wrapperRegistered : Inv48.Source.model.core.findFunctionByName? name = some wrapper)
 :
    ∃ p : Plan Inv48.Source.model.core.table wrapper.body,
      plan 100 Inv48.Source.model.core.table wrapper.body = some p ∧
      p.args = Inv48.WrapperArgs.callArgs ∧
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
  obtain ⟨p,found,raw⟩ := bothRawQuote name wrapper member wrapperRegistered
  exact ⟨p,found,Inv48.WrapperArgs.plannedArgs name wrapper member wrapperRegistered p found,raw⟩
end Inv48.WrapperTraversal
