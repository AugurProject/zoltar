import Inv48WholeQuoteEventsWhole
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WholeQuoteEvents
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Match and fold precisely the retained whole quote slice of the original
policy observation, under the original parentRows. No universal quote-prefix
matching premise and no independent quote evaluation are used. -/
theorem observedWhole {α : Type}
    (ec : Context) (state : State) (data : List Source.Byte)
    (fuel childBudget parentBudget : Nat) (childRows parentRows : ScriptedResponder)
    (root : SolI α) (observed : Inv48.NestedResponder.Observation root)
    (computed : Inv48.ObservedEscrowResponder.observe parentBudget
      (Inv48.ObservedEscrowResponder.policy ec state data fuel childBudget childRows parentRows)
      root = some observed)
    (before trace after : Interaction.Transcript)
    (split : observed.trace = before ++ trace ++ after)
    (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : bounty<Inv32Division.R)
    (final : Runtime)
    (execution : Interaction.Executes (Stmt.eval (n+55) Inv48.Source.model.core.table c
      (Inv48.WholeQuote.entry physical p a bounty) Inv48.WholeQuote.bodyP.value)
      trace (.ok (.normal final))) :
    ∃ w : Witness n c physical p a bounty trace final, ∀ _e : Environment w,
      Inv48.ChildExtraction.Matches parentRows trace ∧
      (Stmt.eval (n+55) Inv48.Source.model.core.table c (Inv48.WholeQuote.entry physical p a bounty)
        Inv48.WholeQuote.bodyP.value).runWith parentRows = .ok (.normal final) := by
  obtain ⟨w⟩ := witness n c physical p a bounty hp ha hb trace final execution
  refine ⟨w,fun e => ⟨?_,?_⟩⟩
  · exact Inv48.QuotePrefixPolicy.prefixMatches ec state data fuel childBudget parentBudget
      childRows parentRows root observed computed before trace after split (excludes w e ec state data)
  · exact Inv48.QuotePrefixPolicy.foldObservedPrefix ec state data fuel childBudget parentBudget
      childRows parentRows root observed computed before trace after split (excludes w e ec state data)
      _ (Result.normal final) execution
end Inv48.WholeQuoteEvents
