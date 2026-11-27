import Inv12ResponderStorage
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def NoCoordinatorWrites (r : ScriptedResponder) := ∀ row ∈ r.callRows, ∀ p, row.2=some p → p.selfStorageWrites=[]

theorem matchedReply (c : Context) (r : ScriptedResponder) (w : Shared.OpenWorld)
    (req : EvmCompiler.Simulation.CallRequest) (out : EvmCompiler.Simulation.CallResponse)
    (clean : NoCoordinatorWrites r) (matchRow : r.answerCall? w req=some out) :
    selfStore c out.postWorld=selfStore c w := by
  unfold ScriptedResponder.answerCall? at matchRow
  dsimp only at matchRow
  split at matchRow
  · rename_i row hit
    simp only [Option.map_some,Option.some.injEq] at matchRow
    subst out
    have member := List.mem_of_find?_eq_some hit
    rcases row with ⟨result,post⟩
    cases post with
    | none => exact debitStore _ _ _ _
    | some p =>
      have hw := clean _ member p rfl
      apply (deltaStore _ _ _ _ hw).trans
      split <;> first | rfl | apply debitStore
  · obtain ⟨row,hit,eq⟩ := Option.map_eq_some_iff.mp matchRow
    subst out
    have member := List.mem_of_find?_eq_some hit
    rcases row with ⟨result,post⟩
    cases post with
    | none => exact debitStore _ _ _ _
    | some p =>
      have hw := clean _ member p rfl
      apply (deltaStore _ _ _ _ hw).trans
      split <;> first | rfl | apply debitStore
end Inv12
