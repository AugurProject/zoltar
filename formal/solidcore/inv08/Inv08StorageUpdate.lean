import Inv08Storage
import Std.Data.HashMap.Lemmas
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08
theorem writeField (c : Context) (r : Runtime) (k : Field) (v : Nat) (fits : v < R)
    (fields : c.storageFields = model.core.context.storageFields) :
    r.storeStorageField c k.name (.word v) =
      .ok {r with state := r.state.storeFieldWord k.field v} := by
  have lookup : c.storageField? k.name = some k.field := by
    change c.storageFields.find? _ = _
    rw [fields]; exact fieldLookup k
  unfold Runtime.storeStorageField
  rw [lookup]
  have clean : Shared.norm v = v := Nat.mod_eq_of_lt fits
  have mat : r.storageMaterializedValue (.word v) = .ok (.word v) := by
    simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel]
  have conv : coerceStorageWordAs .uint256 (.word v) = .ok v := by
    simp [coerceStorageWordAs, Value.forceAbiLazy, Ty.coerceValue?, Value.asStorageWord?, clean, Bind.bind, Except.bind]
  simp [Bind.bind,Except.bind,mat,Field.field,conv]
theorem slotAfter (s : State) (slot value query : Nat) :
    (s.storeSlot slot value).loadSlot query =
      if Shared.norm slot = Shared.norm query then Shared.norm value else s.loadSlot query := by
  unfold State.storeSlot State.loadSlot StorageMap.lookup? StorageMap.insertLoop
  change (match (s.storage.insert (Shared.norm slot) (Shared.norm value))[Shared.norm query]? with
    | some v => v | none => 0) = _
  rw [Std.HashMap.getElem?_insert]
  by_cases h : Shared.norm slot = Shared.norm query <;> simp [h]
  cases s.storage[Shared.norm query]? <;> rfl
theorem durationFits (s : State) : stored s .duration < R := by
  change Shared.norm _ < R
  exact Nat.mod_lt _ (by decide)
/-- The two accounting cursors occupy distinct full-width slots. -/
theorem cursorsAfter (s : State) (eth rep : Nat) (he : eth < R) (hr : rep < R) :
    let post := (s.storeFieldWord Field.ethCursor.field eth).storeFieldWord Field.repCursor.field rep
    stored post .ethCursor = eth ∧ stored post .repCursor = rep ∧
    stored post .duration = stored s .duration := by
  change ((s.storeSlot 5 eth).storeSlot 6 rep).loadSlot 5 = eth ∧
    ((s.storeSlot 5 eth).storeSlot 6 rep).loadSlot 6 = rep ∧
    wordBitRange 144 48 (((s.storeSlot 5 eth).storeSlot 6 rep).loadSlot 0) =
      wordBitRange 144 48 (s.loadSlot 0)
  simp only [slotAfter, show Shared.norm 5 = 5 from rfl, show Shared.norm 6 = 6 from rfl,
    show Shared.norm 0 = 0 from rfl, show Shared.norm eth = eth from Nat.mod_eq_of_lt he,
    show Shared.norm rep = rep from Nat.mod_eq_of_lt hr]
  norm_num
end Inv08
