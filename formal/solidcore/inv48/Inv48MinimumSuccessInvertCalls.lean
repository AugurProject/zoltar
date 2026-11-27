import Inv48MinimumSuccessInvertSites
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessInvert
open Inv48.RequestDispatch Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
/-- Successful ordinary enclosing execution forces the recovered internal call
to finish normally. A reversion cannot disappear into its real continuation. -/
theorem normalHelper (targets : List String) (key : String) (args : List Expr)
    (route : Blocks Inv48.Source.model.core.table (.internalCall targets key args) fuel Inv48.Public.body)
    (c : Context) (r : Runtime) (trace : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body) trace (.ok out)) :
    ∃ s : Inv48.RequestClassify.Site (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table (.internalCall targets key args) trace out,
      ∃ final during rest, s.after = during ++ rest ∧
        Interaction.Executes (Stmt.eval s.fuel Inv48.Source.model.core.table s.context s.runtime
          (.internalCall targets key args)) during (.ok (.normal final)) ∧
        Interaction.Executes (s.continuation (.normal final)) rest (.ok out) := by
  have reject : Rejects pure out := by
    intro v bad tr exec
    cases exec
    exact ordinary bad
  have unit : (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body >>= pure) =
      Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body := Interaction.bind_pure _
  have recovered := site route c r pure trace out reject (by rwa [unit])
  rw [unit] at recovered
  obtain ⟨s,_,rej⟩ := recovered
  obtain ⟨value,during,rest,split,first,last⟩ := bindSuccess _ _ _ _ s.suffix
  have never := Inv48.FundingFallthrough.neverSound 1 (.internalCall targets key args) rfl
    s.fuel Inv48.Source.model.core.table s.context s.runtime
  have normal : ∃ final, value = .normal final := by
    cases value with
    | normal final => exact ⟨final,rfl⟩
    | returned rt vs => exact False.elim (never _ _ _ first)
    | _ => apply False.elim; apply rej _ ?_ rest last; trivial
  obtain ⟨final,rfl⟩ := normal
  exact ⟨s,final,during,rest,split,first,last⟩
end Inv48.MinimumSuccessInvert
