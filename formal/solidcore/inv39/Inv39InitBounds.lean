import Inv39InitWrites
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init
def canonical (s : State) := ∀ q, s.loadSlot q<R
theorem slotCanonical (s : State) (i word : Nat) (h : canonical s) : canonical (s.storeSlot i word) := by
  intro q; rw [loadAfterWrite]
  split
  · exact Nat.mod_lt _ (by decide : 0<R)
  · exact h _
theorem bytesCanonical (s : State) (slot : Nat) (bs : List Source.Byte) (initial : canonical s) :
    canonical (s.storeStorageBytesAt slot bs) := by
  have store (n : Nat) (s : State) (i : Nat) (bs : List Source.Byte) (h : canonical s) :
      canonical (s.storeStorageBytesLongSlotsFuel n slot i bs) := by
    induction n generalizing s i bs with
    | zero => exact h
    | succ n ih =>
      cases bs with
      | nil => exact h
      | cons byte tail =>
        rw [State.storeStorageBytesLongSlotsFuel]
        · exact ih _ _ _ (slotCanonical _ _ _ h)
        · simp
  have clear (n : Nat) (s : State) (i : Nat) (h : canonical s) :
      canonical (s.clearStorageBytesLongSlotsFuel n slot i) := by
    induction n generalizing s i with
    | zero => exact h
    | succ n ih => rw [State.clearStorageBytesLongSlotsFuel]; exact ih _ _ (slotCanonical _ _ _ h)
  unfold State.storeStorageBytesAt State.clearStorageBytesLongSlots
  apply clear
  split
  · exact slotCanonical _ _ _ initial
  · exact slotCanonical _ _ _ (store _ _ _ _ initial)
theorem canonicalWrites {base post : State} {edits : List Edit} (w : Writes base edits post) (initial : canonical base) : canonical post := by
  induction w with
  | initial => exact initial
  | same prev eq ih => intro q; simpa only [State.loadSlot,eq] using ih q
  | step e prev ih =>
    cases e with
    | scalar i allowed v => exact slotCanonical _ _ _ ih
    | metadata i allowed bs => exact bytesCanonical _ _ _ ih
end Inv39.Init
