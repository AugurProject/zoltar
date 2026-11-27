import Inv48OperationsPublicEntryRecovery
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Successful raw operations entry recovers its actual validation run. The
source plan is constructed here, rather than supplied as a loop occurrence.
Input correspondence at the recovered runtime is deliberately not asserted. -/
theorem rawValidation (wrapper : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some wrapper)
    (n : Nat) (base : Context) (state : State) (self sender value : Nat) (data : List Byte)
    (selector : Nat) (args : List Value)
    (read : ABI.readSelector? data = some selector)
    (selected : Inv48.Source.model.core.findFunctionBySelector? selector = some wrapper)
    (decoded : ABI.decodeFunctionArgs? wrapper (data.drop ABI.selectorBytes) = .ok args) :
    ∃ p : ValidationPlan wrapper.body,
      ∀ (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult),
      ABI.Contract.callCalldataAtFromWithContext (n+p.depth) Inv48.Source.model.core
        base state self sender value data = some raw →
      Interaction.Executes raw trace (.ok out) → out.success = true →
      ∃ entryRuntime result,
        finish Inv48.Source.model.core wrapper state result = .ok out ∧
        Interaction.Executes (Stmt.eval (n+p.depth) Inv48.Source.model.core.table
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
          entryRuntime wrapper.body) trace (.ok result) ∧
        ∃ s : Site (Stmt.eval (n+p.depth) Inv48.Source.model.core.table
          (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data)
          entryRuntime wrapper.body) Inv48.Source.model.core.table
          Inv48.OperationsWrapperArgs.loopP.value trace result,
          s.fuel = n ∧ ∃ final during rest,
            s.after = during++rest ∧
            Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table s.context s.runtime
              Inv48.OperationsWrapperArgs.loopP.value) during (.ok (.normal final)) ∧
            Interaction.Executes (s.continuation (.normal final)) rest (.ok result) ∧
            ∀ price collateral bounty gas batch,
              Inv48.BatchInputLoop.Inputs s.runtime price collateral bounty batch →
              s.runtime.lookupLocal? "requiredGas" = some (.word gas) →
              Inv48.BatchInputLoop.Inputs final price collateral bounty batch := by
  obtain ⟨p⟩ := actualValidationPlan wrapper found
  refine ⟨p,?_⟩
  intro raw trace out linked run success
  have facts := List.all_eq_true.mp bothMetadata "requestSecurityPoolPriceWithOperations" (by decide)
  rw [show Inv48.Source.model.core.findFunctionByName? "requestSecurityPoolPriceWithOperations" = some wrapper
    from found,Option.any_some] at facts
  simp only [Bool.and_eq_true] at facts
  have accepts : wrapper.acceptsValue value = true := by simp [FunctionDef.acceptsValue,facts.1]
  obtain ⟨tree,result,entry,exec,done⟩ := body (n+p.depth) Inv48.Source.model.core base state
    self sender value data selector wrapper args read selected decoded accepts raw trace out linked run
  have ordinary := successfulBodyOrdinary wrapper state result out (oneUint _ facts.2) done success
  unfold FunctionDef.evalBodyEntry at entry
  simp only [FunctionDef.acceptsValue,facts.1,Bool.true_or,if_true] at entry
  cases framed : wrapper.initialFrame? args with
  | none => simp [framed] at entry
  | some frame =>
    simp only [framed,Option.some.injEq] at entry
    rw [← entry] at exec
    exact ⟨_,result,done,exec,validation wrapper p n _ _ trace result ordinary exec⟩
end Inv48.OperationsPublicEntry
