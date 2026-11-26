import Inv39FullPublicBefore
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.FullPublic
/-- Generic join for a constructor/genesis certificate. Starting facts are needed
only at genesis; empty books and a bounded cap at the actual initialization input
are derived from the entire admitted pre-initialization history. -/
theorem fromZeroGenesis {A genesis before priorBalances initial}
    (genesisBooks : Books A genesis []) (genesisSupply : genesis.loadSlot theoretical.slot=0)
    (prehistory : BeforeHistory A genesis [] before priorBalances)
    (sep : SlotSeparation A) (markerKeys : BalanceApart A)
    (caller self uid cap rep : Nat) (out : List Source.Value)
    (initializeRun : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext caller self) before [.word uid,.word cap,.word rep]=some (.returned initial out)) :
    ∃ (edits : List Init.Edit) (writes : Init.Writes before edits initial),
      ∀ (post : State) (fin : Balances) (changes : List Change),
        Init.separated circulating.slot writes →
        (∀ a, A a → Init.separated (balanceSlot a) writes) →
        History A initial [] changes post fin →
        post.loadSlot theoretical.slot-post.loadSlot circulating.slot=
          initial.loadSlot theoretical.slot-(changes.map Change.minted).sum ∧
        (changes.map Change.minted).sum≤initial.loadSlot theoretical.slot ∧
        Shared.norm (post.loadSlot 7)≠0 := by
  obtain ⟨empty,capZero⟩ := beforeHistoryEmpty prehistory sep genesisBooks genesisSupply markerKeys
  obtain ⟨edits,writes,joined⟩ := initializedHistory before initial caller self uid cap rep out initializeRun
    (by rw [capZero]; decide)
  exact ⟨edits,writes,fun post fin changes circ mapped history =>
    joined A post fin changes empty circ mapped sep markerKeys history⟩
#print axioms fromZeroGenesis
end Inv39.FullPublic
