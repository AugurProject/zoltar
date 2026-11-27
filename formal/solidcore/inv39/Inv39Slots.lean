import Inv39WordField
import Std.Data.HashMap.Lemmas
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
/-- Reads after a write use the normalized slot and value even on arbitrary untrusted raw input. -/
theorem loadAfterWrite (s : State) (slot value query : Nat) :
    (s.storeSlot slot value).loadSlot query =
      if Shared.norm slot = Shared.norm query then Shared.norm value else s.loadSlot query := by
  unfold State.storeSlot State.loadSlot StorageMap.lookup? StorageMap.insertLoop
  change (match (s.storage.insert (Shared.norm slot) (Shared.norm value))[Shared.norm query]? with
    | some v => v | none => 0) = _
  rw [Std.HashMap.getElem?_insert]
  by_cases h : Shared.norm slot = Shared.norm query <;> simp [h]
  cases s.storage[Shared.norm query]? <;> rfl
theorem loadUnchanged (s : State) (slot v query : Nat) (distinct : Shared.norm slot ≠ Shared.norm query) :
    (s.storeSlot slot v).loadSlot query = s.loadSlot query := by simp [loadAfterWrite,distinct]
theorem loadChanged (s : State) (slot v : Nat) (fit : v < R) :
    (s.storeSlot slot v).loadSlot slot = v := by simp [loadAfterWrite,show Shared.norm v=v from Nat.mod_eq_of_lt fit]
end Inv39
