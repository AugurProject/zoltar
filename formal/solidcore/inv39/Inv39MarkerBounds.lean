import Inv39MarkerSeparation
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker
/-- Even arbitrary pre-existing headers are decoded after uint256 normalization.
Their clearing footprint is far shorter than the distance from either actual
Keccak start to the wraparound point. -/
private theorem headerBound (word : Nat) (h : StorageBytesHeader)
    (decode : storageBytesHeader? word=.ok h) : h.length<R/2 := by
  have raw : Shared.norm word<R := Nat.mod_lt _ (by decide)
  have half : (Shared.norm word-1)/2 <R/2 := by
    apply (Nat.div_lt_iff_lt_mul (by decide : 0<2)).mpr
    change Shared.norm word-1<R
    exact lt_of_le_of_lt (Nat.sub_le _ _) raw
  unfold storageBytesHeader? at decode
  dsimp only at decode
  split at decode <;> split at decode <;> cases decode
  all_goals
    dsimp only
    first
    | exact half
    | (have small : Shared.norm word % 256 / 2 ≤ 31 := by assumption
       norm_num [R]; omega)

theorem oldChunksBound (s : State) (slot : Nat) : oldChunks s slot < R/64+1 := by
  cases decode : storageBytesHeader? (s.loadSlot slot) with
  | error err => simp [oldChunks,decode]
  | ok h =>
    have bound := headerBound _ h decode
    simp only [oldChunks,decode]
    split
    · unfold storageBytesLongChunkCount
      split
      · norm_num [R]
      · change (h.length+31)/32 < R/64+1
        apply (Nat.div_lt_iff_lt_mul (by decide : 0<32)).mpr
        norm_num [R] at bound ⊢
        omega
    · simp

theorem longDataApart (slot q i : Nat) (metadata : slot=3 ∨ slot=4)
    (fixed : q=3 ∨ q=4 ∨ q=5 ∨ q=6 ∨ q=7) (bound : i<R/64+1) :
    Shared.norm (storageBytesLongDataSlot slot i) ≠ Shared.norm q := by
  obtain ⟨three,four⟩ := metadataStarts
  have range : Shared.norm (dynamicArrayDataSlot slot)+i<R ∧
      7<Shared.norm (dynamicArrayDataSlot slot)+i := by
    rcases metadata with rfl|rfl
    · rw [three]
      norm_num [Shared.norm,Shared.wordModulus,EvmYul.UInt256.size,R] at bound ⊢
      exact ⟨lt_of_lt_of_le (Nat.add_lt_add_left bound _) (by decide),
        lt_of_lt_of_le (by decide) (Nat.le_add_right _ _)⟩
    · rw [four]
      norm_num [Shared.norm,Shared.wordModulus,EvmYul.UInt256.size,R] at bound ⊢
      exact ⟨lt_of_lt_of_le (Nat.add_lt_add_left bound _) (by decide),
        lt_of_lt_of_le (by decide) (Nat.le_add_right _ _)⟩
  have normalized : Shared.norm (storageBytesLongDataSlot slot i)=Shared.norm (dynamicArrayDataSlot slot)+i := by
    change Shared.norm (Shared.norm (Shared.norm (dynamicArrayDataSlot slot)+i))=_
    rw [show ∀ n, Shared.norm (Shared.norm n)=Shared.norm n from fun n=>Nat.mod_mod _ _]
    exact Nat.mod_eq_of_lt range.1
  have qbound : q≤7 := by rcases fixed with rfl|rfl|rfl|rfl|rfl <;> decide
  have qfit : q<R := lt_of_le_of_lt qbound (by decide)
  rw [normalized,show Shared.norm q=q from Nat.mod_eq_of_lt qfit]
  exact Ne.symm (Nat.ne_of_lt (lt_of_le_of_lt qbound range.2))

/-- No freshness or collision axiom: old dynamic contents can be arbitrary.
Only the newly supplied bytes need the bound established for decimal metadata. -/
theorem boundedMetadataFrame (s : State) (slot q : Nat) (bs : List Source.Byte)
    (metadata : slot=3 ∨ slot=4) (fixed : q=3 ∨ q=4 ∨ q=5 ∨ q=6 ∨ q=7)
    (distinct : slot≠q) (length : bs.length≤95) :
    (s.storeStorageBytesAt slot bs).loadSlot q=s.loadSlot q := by
  apply stringFrame
  · rcases metadata with rfl|rfl <;> rcases fixed with rfl|rfl|rfl|rfl|rfl <;> first | contradiction | decide
  · intro i hi
    apply longDataApart slot q i metadata fixed
    have old := oldChunksBound s slot
    have size : bs.length+1<R/64+1 := by norm_num [R]; omega
    omega
end Inv39.Init.Marker
