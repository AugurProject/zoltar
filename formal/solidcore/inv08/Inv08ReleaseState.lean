import Inv08PreviewCall
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Release
def cursor (s : State) (tm : Nat) (eth : Bool) :=
  stored s (cursorField eth) + Preview.payout s tm eth * stored s .duration
def leftover (s : State) (tm : Nat) (eth : Bool) := stored s (outstandingField eth) - Preview.payout s tm eth

def ethCredited (s : State) (tm : Nat) := s.storeFieldWord Field.ethCursor.field (cursor s tm true)
def repCredited (s : State) (tm : Nat) := (ethCredited s tm).storeFieldWord Field.repCursor.field (cursor s tm false)
def ethDebited (s : State) (tm : Nat) := (repCredited s tm).storeFieldWord Field.ethOut.field (leftover s tm true)
def repDebited (s : State) (tm : Nat) := (ethDebited s tm).storeFieldWord Field.repOut.field (leftover s tm false)
def timestamped (s : State) (tm : Nat) := (repDebited s tm).storeFieldWord Field.through.field tm
def post (s : State) (tm : Nat) := (timestamped s tm).storeFieldWord Field.settled.field (Preview.q s tm)

structure Ready (s : State) (tm : Nat) : Prop extends Preview.Ready s tm where
  funded : ∀ eth, Preview.payout s tm eth ≤ stored s (outstandingField eth)
  word : ∀ eth, stored s (outstandingField eth) < R

theorem cursorFit (h : Ready s tm) (eth : Bool) : cursor s tm eth<R := by
  have round := Nat.div_mul_le_self (Preview.value s tm eth-stored s (cursorField eth)) (stored s .duration)
  have ordered := h.cursors eth
  have a := Nat.add_le_add_left round (stored s (cursorField eth))
  rw [Nat.add_sub_of_le ordered] at a
  exact lt_of_le_of_lt a (h.fits eth)

theorem repUnaffected (s : State) (tm : Nat) :
    stored (ethCredited s tm) .repCursor = stored s .repCursor ∧
    stored (ethCredited s tm) .duration = stored s .duration := by
  change (s.storeSlot 5 _).loadSlot 6=s.loadSlot 6 ∧ wordBitRange 144 48 ((s.storeSlot 5 _).loadSlot 0)=_
  rw [slotAfter,if_neg (by decide),slotAfter,if_neg (by decide)]
  exact ⟨rfl,rfl⟩
theorem ethAvailable (s : State) (tm : Nat) : stored (repCredited s tm) .ethOut = stored s .ethOut := by
  change ((s.storeSlot 5 _).storeSlot 6 _).loadSlot 1 = _
  rw [slotAfter,if_neg (by decide),slotAfter,if_neg (by decide)]
  rfl
theorem repAvailable (s : State) (tm : Nat) : stored (ethDebited s tm) .repOut = stored s .repOut := by
  change (((s.storeSlot 5 _).storeSlot 6 _).storeSlot 1 _).loadSlot 2 = _
  rw [slotAfter,if_neg (by decide),slotAfter,if_neg (by decide),slotAfter,if_neg (by decide)]
  rfl
end Inv08.Release
