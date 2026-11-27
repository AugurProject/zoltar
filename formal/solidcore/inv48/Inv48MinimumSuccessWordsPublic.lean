import Inv48MinimumSuccessWordsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessWords
open Inv48.Positive Inv48.WrapperTraversal Inv48.MinimumSuccessInvert
/-- Both checked callee bodies are descended from the same raw execution. All
original helper snapshots, transcript splits and public continuations survive. -/
theorem rawHelperBodies (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Byte) (p : Nat)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok [.word p])
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data
    let r := start (entryBase c state) p
    0 < p ∧ ∃ result,
      Inv48.RequestDispatch.finish Inv48.Source.model.core Inv48.PositiveABI.entry state result = .ok out ∧
      Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body) trace (.ok result) ∧
      CompletedBody (n+5) c r trace result [ret1] key1 ∧
      CompletedBody (n+5) c r trace result [ret2] key2 := by
  obtain ⟨positive,result,finish,body,first,second⟩ := rawHelpers n base state self sender data p
    read selected decoded raw trace out linked run success
  exact ⟨positive,result,finish,body,completedBody first,completedBody second⟩
end Inv48.MinimumSuccessWords
