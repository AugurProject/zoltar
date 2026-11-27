import Inv48ObservedEscrowResponderCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuotePrefixPolicy
set_option maxRecDepth 65536

/-- The original nested policy supplies the original parent rows at every
query except its one exact escrow suspension. No replacement policy is used. -/
theorem parentAnswer (c : Context) (state : State) (data : List Byte)
    (fuel budget : Nat) (childRows parentRows : ScriptedResponder)
    (q : Query) (different : q ≠ Inv48.ObservedEscrowResponder.query c state data) :
    Inv48.ObservedEscrowResponder.policy c state data fuel budget childRows parentRows q =
      Inv48.NestedResponder.answer parentRows q := by
  classical
  simp [Inv48.ObservedEscrowResponder.policy, different]

/-- Every event of a retained prefix is answered by the original parent rows
provided that the distinguished escrow query is absent from that prefix.
The exclusion is a structural obligation, not assumed oracle agreement. -/
theorem prefixMatches {α : Type} (c : Context) (state : State) (data : List Byte)
    (fuel childBudget parentBudget : Nat) (childRows parentRows : ScriptedResponder)
    (root : SolI α) (observed : Inv48.NestedResponder.Observation root)
    (computed : Inv48.ObservedEscrowResponder.observe parentBudget
      (Inv48.ObservedEscrowResponder.policy c state data fuel childBudget childRows parentRows)
      root = some observed)
    (before body after : Interaction.Transcript)
    (split : observed.trace = before ++ body ++ after)
    (excluded : ∀ event ∈ body,
      event.query ≠ Inv48.ObservedEscrowResponder.query c state data) :
    Inv48.ChildExtraction.Matches parentRows body := by
  have aligned := Inv48.ObservedEscrowResponder.observedMatches parentBudget _ root observed computed
  intro event member
  have matched := aligned event (by
    rw [split]
    exact List.mem_append_left after (List.mem_append_right before member))
  rw [parentAnswer c state data fuel childBudget childRows parentRows event.query
    (excluded event member)] at matched
  exact matched

/-- Repeated occurrences of the *same complete query* have the same dependent
answer under the original policy, even when the distinguished query repeats. -/
theorem repeatedAnswer (answers : Inv48.ObservedEscrowResponder.Policy)
    (trace : Interaction.Transcript) (aligned : Inv48.ObservedEscrowResponder.Matches answers trace)
    (q : Query) (a b : Answer q)
    (first : ⟨q,a⟩ ∈ trace)
    (second : ⟨q,b⟩ ∈ trace) : a = b := by
  have one := aligned ⟨q,a⟩ first
  have two := aligned ⟨q,b⟩ second
  exact Option.some.inj (one.symm.trans two)

/-- Fold a successful body slice of the very same policy observation. The
structural exclusion is restricted to that slice, not the parent transcript
(which normally contains the distinguished escrow event). -/
theorem foldObservedPrefix {α β : Type}
    (c : Context) (state : State) (data : List Byte)
    (fuel childBudget parentBudget : Nat) (childRows parentRows : ScriptedResponder)
    (root : SolI α) (observed : Inv48.NestedResponder.Observation root)
    (computed : Inv48.ObservedEscrowResponder.observe parentBudget
      (Inv48.ObservedEscrowResponder.policy c state data fuel childBudget childRows parentRows)
      root = some observed)
    (before body after : Interaction.Transcript)
    (split : observed.trace = before ++ body ++ after)
    (excluded : ∀ event ∈ body,
      event.query ≠ Inv48.ObservedEscrowResponder.query c state data)
    (tree : SolI β) (actual : β)
    (execution : Interaction.Executes tree body (.ok actual)) :
    tree.runWith parentRows = .ok actual := by
  exact Inv48.ChildExtraction.foldTrace parentRows tree body actual
    (prefixMatches c state data fuel childBudget parentBudget childRows parentRows
      root observed computed before body after split excluded) execution

#print axioms parentAnswer
#print axioms prefixMatches
#print axioms repeatedAnswer
end Inv48.QuotePrefixPolicy

#print axioms Inv48.QuotePrefixPolicy.foldObservedPrefix
