import Inv08FundingTransition
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv08
open ExpiryStorage
/-- Per-history non-overlap of the concrete Solidity mapping locations used by the funding history. -/
structure Separated (last : Nat) : Prop where
  scalar : ∀ id, id≤last → ∀ i : Fin 5, ∀ k : Nat, k≤6 →
    Shared.norm (memberSlot (mappingStorageSlot 7 id) i) ≠ Shared.norm k
  different : ∀ i j, i≤last → j≤last → i≠j → ∀ a b : Fin 5,
    Shared.norm (memberSlot (mappingStorageSlot 7 i) a) ≠ Shared.norm (memberSlot (mappingStorageSlot 7 j) b)

theorem scalarCongr (s t : State) (k : Field) (same : s.loadSlot k.slot=t.loadSlot k.slot) :
    stored s k=stored t k := by
  simp [stored,State.loadFieldWord,State.loadFieldSlot,Field.field,same]

theorem frameField (s : State) (k : Field) (value key : Nat)
    (sep : Shared.norm k.slot ≠ Shared.norm key) :
    (s.storeFieldWord k.field value).loadSlot key = s.loadSlot key := by
  unfold State.storeFieldWord
  split <;> simp [State.storeFieldSlot,Field.field,slotAfter,sep]

theorem tupleCongr (s t : State) (slot : Nat)
    (same : ∀ j : Fin 5, s.loadSlot (memberSlot slot j) = t.loadSlot (memberSlot slot j)) :
    tuple s slot = tuple t slot := by
  have eq (j : Nat) (h : j<5) : s.loadSlot (memberSlot slot j)=t.loadSlot (memberSlot slot j) := same ⟨j,h⟩
  unfold tuple memberWord
  rw [eq 0 (by decide),eq 1 (by decide),eq 2 (by decide),eq 3 (by decide),eq 4 (by decide)]

theorem beforeRecord (s : State) (last id : Nat) (le : id≤last) (sep : Separated last) (k : Field) (v : Nat) :
    tuple (s.storeFieldWord k.field v) (mappingStorageSlot 7 id) = tuple s (mappingStorageSlot 7 id) := by
  apply tupleCongr
  intro j
  exact frameField _ _ _ _ (Ne.symm (sep.scalar _ le j _ (by cases k <;> decide)))

theorem afterRecord (s : State) (last id : Nat) (le : id≤last) (sep : Separated last) (e : Record) (k : Field) :
    stored (install s (mappingStorageSlot 7 id) e) k = stored s k :=
  scalarCongr _ _ k (FundingHistory.frameSlot _ _ _ _ (fun j => sep.scalar id le j k.slot (by cases k <;> decide)))
end Inv08
