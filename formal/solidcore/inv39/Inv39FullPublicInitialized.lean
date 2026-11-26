import Inv39FullPublicHistory
import Inv39FullPublicBounds
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.FullPublic
/-- Conditional initializer join. The empty pre-initialization books must be
established from reachable deployment, rather than inferred from initialization:
initialize does not reset arbitrary pre-existing circulating supply or balances. -/
theorem initializedHistory (before initial : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) before [.word uid,.word cap,.word rep]=some (.returned initial out))
    (fresh : before.loadSlot theoretical.slot<R) :
    ∃ (edits : List Init.Edit) (writes : Init.Writes before edits initial),
      ∀ (A : Nat → Prop) (post : State) (fin : Balances) (changes : List Change),
        Books A before [] → Init.separated circulating.slot writes →
        (∀ a, A a → Init.separated (balanceSlot a) writes) →
        SlotSeparation A → BalanceApart A → History A initial [] changes post fin →
        post.loadSlot theoretical.slot-post.loadSlot circulating.slot=
          initial.loadSlot theoretical.slot-(changes.map Change.minted).sum ∧
        (changes.map Change.minted).sum≤initial.loadSlot theoretical.slot ∧
        Shared.norm (post.loadSlot 7)≠0 := by
  obtain ⟨⟨edits,writes⟩⟩ := Init.publicWrites before initial sender self uid cap rep out run
  refine ⟨edits,writes,?_⟩
  intro A post fin changes zero circ mapped sep markerKeys history
  have installed := (Init.Marker.installedMarker before initial sender self uid cap rep out run).2
  obtain ⟨eq,bound,same⟩ := headroom history sep (Init.books writes A zero circ mapped)
    (writesBound writes _ fresh) markerKeys installed
  exact ⟨eq,bound,by rwa [same]⟩
#print axioms initializedHistory
end Inv39.FullPublic
