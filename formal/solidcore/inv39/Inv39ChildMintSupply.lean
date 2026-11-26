import Inv39TraceEmbedding
import Inv39CommittedMints
import Inv39UniversalGenesisExecution
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.TraceEmbedding

theorem childHeadroom {A genesis before priorBalances initial}
    (c : Context) (owner sender : Nat) (nonzero : Shared.norm owner≠0)
    (nameField : c.storageField? "_name"=some (Init.field .name))
    (symbolField : c.storageField? "_symbol"=some (Init.field .symbol))
    (immutableField : c.immutableField? "zoltar"=some ⟨"zoltar",.address⟩)
    (freshKeys : ∀ a, A a → Shared.norm (balanceSlot a)∉UniversalGenesis.slots)
    (deploy : TypeCheck.CheckedContract.constructWithContext? 50000 model c State.empty sender 0 [.word owner]=some (.returned genesis []))
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
  obtain ⟨s,actual,books,zero⟩ := UniversalGenesis.deploymentBooks c owner sender nonzero nameField symbolField immutableField A freshKeys
  rw [deploy] at actual
  cases actual
  exact committedMintsFromGenesis books zero prior sep keys caller self uid cap rep out initRun

#print axioms childHeadroom
end Inv39.TraceEmbedding
