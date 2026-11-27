import Inv39FullPublicReachable
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.UniversalGenesis
/-- The two short-string writes executed by the generated ERC20 base constructor. -/
def seed : State :=
  (State.empty.storeStorageBytesAt 3 [82,101,112,117,116,97,116,105,111,110]).storeStorageBytesAt 4 [82,69,80]
def slots : List Nat := [3,4]
def facts (s : State) : Bool :=
  s.storage.keys.all (fun k => slots.contains k) &&
  s.loadSlot circulating.slot==0 && s.loadSlot theoretical.slot==0
theorem seedFacts : facts seed := by native_decide
/-- This lemma is used only after the actual constructor execution establishes its storage. -/
theorem booksFromStorage (s : State) (storage : s.storage=seed.storage) (A : Nat → Prop)
    (keys : ∀ a, A a → Shared.norm (balanceSlot a)∉slots) :
    Books A s [] ∧ s.loadSlot theoretical.slot=0 := by
  have all : facts s := by simpa only [facts,State.loadSlot,storage] using seedFacts
  simp only [facts,Bool.and_eq_true,beq_iff_eq] at all
  obtain ⟨⟨present,issued⟩,cap⟩ := all
  refine ⟨⟨?_,issued⟩,cap⟩
  intro a ha
  have absent : Shared.norm (balanceSlot a)∉s.storage := by
    intro mem
    exact keys a ha (List.contains_iff_mem.mp (List.all_eq_true.mp present _ (Std.HashMap.mem_keys.mpr mem)))
  have no := Std.HashMap.getElem?_eq_none absent
  change (match s.storage[Shared.norm (balanceSlot a)]? with | some v => v | none => 0)=0
  rw [no]
#print axioms seedFacts
#print axioms booksFromStorage
end Inv39.UniversalGenesis
