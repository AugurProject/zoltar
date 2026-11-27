import Inv39Slots
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39
private theorem clearChunks (n : Nat) (s : State) (slot pos query : Nat)
    (apart : ∀ i, pos≤i → i<pos+n → Shared.norm (storageBytesLongDataSlot slot i) ≠ Shared.norm query) :
    (s.clearStorageBytesLongSlotsFuel n slot pos).loadSlot query = s.loadSlot query := by
  induction n generalizing s pos with
  | zero => rfl
  | succ n ih =>
    rw [State.clearStorageBytesLongSlotsFuel,ih _ (pos+1) (fun i lo hi => apart i (by omega) (by omega))]
    exact loadUnchanged _ _ _ _ (apart _ (by omega) (by omega))
private theorem storeChunks (n : Nat) (s : State) (slot pos query : Nat) (bs : List Source.Byte)
    (apart : ∀ i, pos≤i → i<pos+n → Shared.norm (storageBytesLongDataSlot slot i) ≠ Shared.norm query) :
    (s.storeStorageBytesLongSlotsFuel n slot pos bs).loadSlot query = s.loadSlot query := by
  induction n generalizing s pos bs with
  | zero => rfl
  | succ n ih =>
    cases bs with
    | nil => rfl
    | cons b bs =>
      rw [State.storeStorageBytesLongSlotsFuel,ih _ (pos+1) _ (fun i lo hi => apart i (by omega) (by omega))]
      exact loadUnchanged _ _ _ _ (apart _ (by omega) (by omega))
      simp
def oldChunks (s : State) (slot : Nat) :=
  match storageBytesHeader? (s.loadSlot slot) with
  | .ok h => if h.long then storageBytesLongChunkCount h.length else 0
  | .error _ => 0
/-- Writing either short or long Solidity string metadata preserves a nonoverlapping REP storage word,
including the clear of a previously longer payload. The separation premise mentions a finite range. -/
theorem stringFrame (s : State) (slot query : Nat) (bytes : List Source.Byte)
    (apart : Shared.norm slot ≠ Shared.norm query)
    (dataApart : ∀ i, i < max (bytes.length+1) (oldChunks s slot) →
      Shared.norm (storageBytesLongDataSlot slot i) ≠ Shared.norm query) :
    (s.storeStorageBytesAt slot bytes).loadSlot query = s.loadSlot query := by
  let bs := bytes.map normByte
  let fresh := storageBytesLongChunkCount bs.length
  let old := oldChunks s slot
  unfold State.storeStorageBytesAt State.clearStorageBytesLongSlots
  change (State.clearStorageBytesLongSlotsFuel (old-fresh) _ slot fresh).loadSlot query=_
  rw [clearChunks (old-fresh) _ slot fresh query (fun i lo hi => dataApart i (by
    have : i<old := by omega
    exact lt_of_lt_of_le this (Nat.le_max_right _ _)))]
  split
  · exact loadUnchanged _ _ _ _ apart
  · rw [loadUnchanged _ _ _ _ apart]
    apply storeChunks
    intro i lo hi
    apply dataApart
    exact lt_of_lt_of_le (by simpa [bs] using hi) (Nat.le_max_left _ _)
end Inv39
