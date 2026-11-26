import Inv39TraceEmbedding
import Inv39FullPublicReachable
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.TraceEmbedding

theorem committedMintsFromGenesis {A genesis before priorBalances initial}
    (books : Books A genesis []) (zero : genesis.loadSlot theoretical.slot=0)
    (prior : FullPublic.BeforeHistory A genesis [] before priorBalances)
    (sep : SlotSeparation A) (keys : BalanceApart A)
    (caller self uid cap rep : Nat) (out : List Source.Value)
    (initRun : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext caller self) before [.word uid,.word cap,.word rep]=some (.returned initial out)) :
    ∃ (edits : List Init.Edit) (writes : Init.Writes before edits initial),
      ∀ {post} (calls : Calls initial post), (∀ a∈participants calls, A a) → Admissible A calls →
        Init.separated circulating.slot writes → (∀ a, A a → Init.separated (balanceSlot a) writes) →
        post.loadSlot theoretical.slot-post.loadSlot circulating.slot =
          initial.loadSlot theoretical.slot-(successfulMints calls).sum ∧
        (successfulMints calls).sum ≤ initial.loadSlot theoretical.slot ∧ Shared.norm (post.loadSlot 7)≠0 := by
  obtain ⟨es,ws,history⟩ := FullPublic.fromZeroGenesis books zero prior sep keys caller self uid cap rep out initRun
  refine ⟨es,ws,?_⟩
  intro post calls seen physical circ mapped
  obtain ⟨fin,steps⟩ := complete calls A seen physical []
  rw [successfulMints_sum calls]
  exact history post fin _ circ mapped steps

#print axioms committedMintsFromGenesis
end Inv39.TraceEmbedding
