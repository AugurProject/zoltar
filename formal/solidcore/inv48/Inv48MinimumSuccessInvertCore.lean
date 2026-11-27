import Inv48WrapperTraversalRaw
import Inv48PositiveABI
import Inv48PositiveABIConstants
import Inv48PositiveSyntax
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessInvert
open Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Actual generated selector, without a synthetic public context or responder. -/
theorem selector : Inv48.PositiveABI.entry.selector? = some 4197127132 := by
  rw [Inv48.PositiveABI.metadata.2.1, Inv48.PositiveABI.selector_value]

/-- Raw ABI success recovers the body on the entire original transcript. ABI decoding
is the real decoder (trailing reply bytes are not restricted). No BothMinimum input,
positive-price premise, arithmetic bound or internal execution is supplied. -/
theorem rawBody (fuel : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Byte) (args : List Value)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok args)
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext fuel Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    ∃ frame result,
      Inv48.PositiveABI.entry.initialFrame? args = some frame ∧
      finish Inv48.Source.model.core Inv48.PositiveABI.entry state result = .ok out ∧
      ¬ Escapes result ∧
      Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table
        (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data)
        ((entryBase (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data) state).withFrame frame)
        Inv48.Public.body) trace (.ok result) := by
  have accepts : Inv48.PositiveABI.entry.acceptsValue 0 = true := by
    simp [FunctionDef.acceptsValue,wordEq]
  obtain ⟨tree,result,entry,exec,done⟩ := Inv48.RequestDispatch.body fuel _ base state self sender 0 data
    4197127132 Inv48.PositiveABI.entry args read selected decoded accepts raw trace out linked run
  have ordinary := successfulBodyOrdinary Inv48.PositiveABI.entry state result out
    (by rw [Inv48.PositiveABI.metadata.2.2.2.2]; rfl) done success
  unfold FunctionDef.evalBodyEntry at entry
  simp only [FunctionDef.acceptsValue, ABI.Contract.callContextAtWithBase, wordEq, SolidCore.Solidity.Shared.norm, Nat.zero_mod, beq_self_eq_true, Bool.or_true, if_true] at entry
  cases framed : Inv48.PositiveABI.entry.initialFrame? args with
  | none => simp [framed] at entry
  | some frame =>
    simp only [framed,Option.some.injEq] at entry
    rw [← entry,Inv48.PositiveABI.body] at exec
    exact ⟨frame,result,rfl,done,ordinary,exec⟩
end Inv48.MinimumSuccessInvert
