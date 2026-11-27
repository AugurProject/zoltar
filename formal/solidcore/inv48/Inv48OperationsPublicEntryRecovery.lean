import Inv48OperationsPublicEntryPlan
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
/-- Recover the validation run and its continuation from the same successful
whole-wrapper execution. Neither occurrence nor loop execution is a premise. -/
theorem validation (wrapper : FunctionDef) (p : ValidationPlan wrapper.body)
    (n : Nat) (c : Context) (r : Runtime) (trace : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+p.depth) Inv48.Source.model.core.table c r wrapper.body)
      trace (.ok out)) :
    ∃ s : Site (Stmt.eval (n+p.depth) Inv48.Source.model.core.table c r wrapper.body)
      Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value trace out,
      s.fuel = n ∧ ∃ final during rest,
        s.after = during++rest ∧
        Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table s.context s.runtime
          Inv48.OperationsWrapperArgs.loopP.value) during (.ok (.normal final)) ∧
        Interaction.Executes (s.continuation (.normal final)) rest (.ok out) ∧
        ∀ price collateral bounty gas batch,
          Inv48.BatchInputLoop.Inputs s.runtime price collateral bounty batch →
          s.runtime.lookupLocal? "requiredGas" = some (.word gas) →
          Inv48.BatchInputLoop.Inputs final price collateral bounty batch := by
  have reject : Rejects pure out := by
    intro v bad tr exec
    cases exec
    exact ordinary bad
  have unit : (Stmt.eval (n+p.depth) Inv48.Source.model.core.table c r wrapper.body >>= pure) =
      Stmt.eval (n+p.depth) Inv48.Source.model.core.table c r wrapper.body := Interaction.bind_pure _
  have recovered := site (p.build n) c r pure trace out reject (by rwa [unit])
  rw [unit] at recovered
  obtain ⟨s,fuel,rej⟩ := recovered
  rw [p.leaf] at fuel
  obtain ⟨v,during,rest,split,first,last⟩ := bindSuccess _ _ _ _ s.suffix
  have falls := safeSound 100 _ validationSafe s.fuel s.context s.runtime during v first
  have normal : ∃ final, v = .normal final := by
    cases v with
    | normal final => exact ⟨final,rfl⟩
    | reverted rt err => exact False.elim (rej (.reverted rt err) trivial rest last)
    | _ => contradiction
  obtain ⟨final,rfl⟩ := normal
  have loopRun : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table s.context s.runtime
      Inv48.OperationsWrapperArgs.loopP.value) during (.ok (.normal final)) := by
    simpa only [fuel] using first
  exact ⟨s,fuel,final,during,rest,split,loopRun,last,fun price collateral bounty gas batch inputs bound =>
    Inv48.BatchLoopClosure.validationInputs n s.context s.runtime final price collateral bounty gas batch
      during inputs bound loopRun⟩
end Inv48.OperationsPublicEntry
