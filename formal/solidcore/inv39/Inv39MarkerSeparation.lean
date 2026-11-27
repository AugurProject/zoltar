import Inv39RepeatExclusion
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker
/-- These are concrete Keccak computations, not an injectivity assumption. -/
theorem metadataStarts :
    dynamicArrayDataSlot 3 = 87903029871075914254377627908054574944891091886930582284385770809450030037083 ∧
    dynamicArrayDataSlot 4 = 62514009886607029107290561805838585334079798074568712924583230797734656856475 := by
  native_decide
private theorem finiteSlots :
    ([3,4].all fun slot => (List.range 96).all fun i =>
      [3,4,5,6,7].all fun q => Shared.norm (storageBytesLongDataSlot slot i) != Shared.norm q) = true := by
  native_decide
/-- Covers more than the actual three chunks needed by the longest name (95 bytes).
The conservative bound matches the existing stringFrame API. -/
theorem dataApart (slot q i : Nat) (metadata : slot=3 ∨ slot=4)
    (fixed : q=3 ∨ q=4 ∨ q=5 ∨ q=6 ∨ q=7) (bound : i<96) :
    Shared.norm (storageBytesLongDataSlot slot i) ≠ Shared.norm q := by
  have hs : slot ∈ [3,4] := by rcases metadata with rfl|rfl <;> simp
  have hq : q ∈ [3,4,5,6,7] := by rcases fixed with rfl|rfl|rfl|rfl|rfl <;> simp
  have h := List.all_eq_true.mp (List.all_eq_true.mp (List.all_eq_true.mp finiteSlots slot hs) i (List.mem_range.mpr bound)) q hq
  simpa using h
/-- Fresh initialization uses empty metadata headers, not merely canonical storage. -/
theorem noOldChunks (s : State) (slot : Nat) (fresh : s.loadSlot slot=0) : oldChunks s slot=0 := by
  simp [oldChunks,fresh,storageBytesHeader?,Shared.norm]
theorem metadataFrame (s : State) (slot q : Nat) (bs : List Source.Byte)
    (metadata : slot=3 ∨ slot=4) (fixed : q=3 ∨ q=4 ∨ q=5 ∨ q=6 ∨ q=7)
    (distinct : slot≠q) (length : bs.length≤95) (old : oldChunks s slot≤96) :
    (s.storeStorageBytesAt slot bs).loadSlot q=s.loadSlot q := by
  apply stringFrame
  · rcases metadata with rfl|rfl <;> rcases fixed with rfl|rfl|rfl|rfl|rfl <;> first | contradiction | decide
  · intro i hi
    exact dataApart slot q i metadata fixed (by omega)
end Inv39.Init.Marker
