import Inv39Initialize
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.FullPublic
/-- Per-key range preservation needs no assumption on unrelated raw storage. -/
theorem slotBound (s : State) (q i word : Nat) (h : s.loadSlot q<R) :
    (s.storeSlot i word).loadSlot q<R := by
  rw [loadAfterWrite]
  split
  · exact Nat.mod_lt _ (by decide : 0<R)
  · exact h

theorem bytesBound (s : State) (q slot : Nat) (bs : List Source.Byte) (initial : s.loadSlot q<R) :
    (s.storeStorageBytesAt slot bs).loadSlot q<R := by
  have store (n : Nat) (s : State) (i : Nat) (bs : List Source.Byte) (h : s.loadSlot q<R) :
      (s.storeStorageBytesLongSlotsFuel n slot i bs).loadSlot q<R := by
    induction n generalizing s i bs with
    | zero => exact h
    | succ n ih =>
      cases bs with
      | nil => exact h
      | cons byte tail =>
        rw [State.storeStorageBytesLongSlotsFuel]
        · exact ih _ _ _ (slotBound _ _ _ _ h)
        · simp
  have clear (n : Nat) (s : State) (i : Nat) (h : s.loadSlot q<R) :
      (s.clearStorageBytesLongSlotsFuel n slot i).loadSlot q<R := by
    induction n generalizing s i with
    | zero => exact h
    | succ n ih => rw [State.clearStorageBytesLongSlotsFuel]; exact ih _ _ (slotBound _ _ _ _ h)
  unfold State.storeStorageBytesAt State.clearStorageBytesLongSlots
  apply clear
  split
  · exact slotBound _ _ _ _ initial
  · exact slotBound _ _ _ _ (store _ _ _ _ initial)

theorem writesBound {base post : State} {edits : List Init.Edit} (w : Init.Writes base edits post)
    (q : Nat) (initial : base.loadSlot q<R) : post.loadSlot q<R := by
  induction w with
  | initial => exact initial
  | same prev eq ih => simpa only [State.loadSlot,eq] using ih
  | step e prev ih =>
    cases e with
    | scalar i allowed v => exact slotBound _ _ _ _ ih
    | metadata i allowed bs => exact bytesBound _ _ _ _ ih
#print axioms writesBound
end Inv39.FullPublic
