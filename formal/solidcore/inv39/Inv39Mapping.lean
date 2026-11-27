import Inv39MappingLayout
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
def balanceSlot (a : Nat) := mappingStorageSlot 0 (Shared.norm a)
private theorem key (a : Nat) : mappingStorageSlotForKey 0 .address (.word a) = .ok (balanceSlot a) := by
  simp [balanceSlot,mappingStorageSlotForKey,coerceMappingKeyWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,Bind.bind,Except.bind]
private theorem lookup (c : Context) (fields : c.storageFields=model.core.context.storageFields) :
    c.storageField? "_balances"=some balanceField := by
  change c.storageFields.find? _ = _
  rw [fields]; exact balanceLayout
theorem readBalance (c : Context) (r : Runtime) (a : Nat) (fields : c.storageFields=model.core.context.storageFields) :
    r.loadStorageIndex c "_balances" (.word a) = .ok (.word (r.state.loadSlot (balanceSlot a))) := by
  unfold Runtime.loadStorageIndex
  rw [lookup _ fields]
  simp only [Bind.bind,Except.bind,balanceField,key]
  simp [State.loadStorageLayoutAt,State.loadStorageLayoutAtFuel,loadStorageWordAs,Ty.storageValueFromWord?]
theorem writeBalance (c : Context) (r : Runtime) (a v : Nat) (fit : v<R)
    (fields : c.storageFields=model.core.context.storageFields) :
    r.storeStorageIndexWithDeepClear c "_balances" (.word a) (.word v) =
      .ok {r with state:=r.state.storeSlot (balanceSlot a) v} := by
  have mat : r.storageMaterializedValue (.word v) = .ok (.word v) := by
    simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel]
  unfold Runtime.storeStorageIndexWithDeepClear
  rw [lookup _ fields]
  simp only [Bind.bind,Except.bind,balanceField,mat,key]
  change Except.ok { r with state := r.state.storeSlot (balanceSlot a) (Shared.norm v) } = _
  rw [show Shared.norm v=v from Nat.mod_eq_of_lt fit]
end Inv39
