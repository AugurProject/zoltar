import Inv48RequestClassifyCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- Two completed prefixes of the same tree on the same larger trace have
identical consumed transcripts and values. This is stronger than uniqueness
with an already supplied equal prefix length. -/
theorem completedPrefixUnique {α : Type} {tree : SolI α}
    {xs ys left right : Interaction.Transcript} {a b : α}
    (first : Interaction.Executes tree xs (.ok a))
    (second : Interaction.Executes tree ys (.ok b))
    (same : xs++left = ys++right) : xs = ys ∧ a = b := by
  generalize ha : (Except.ok a : Except SolidityFailure α) = outcome at first
  induction first generalizing a ys b left right with
  | done outcome =>
    cases ha
    cases second
    exact ⟨rfl,rfl⟩
  | @request query resume answer xs outcome tail ih =>
    cases second with
    | request other rest =>
      have head := (List.cons.inj same).1
      have answers : answer = other := by
        cases head
        rfl
      subst other
      obtain ⟨tr,value⟩ := ih rest (List.cons.inj same).2 ha
      exact ⟨congrArg (fun t => ⟨query,answer⟩::t) tr,value⟩
end Inv48.RequestClassify
