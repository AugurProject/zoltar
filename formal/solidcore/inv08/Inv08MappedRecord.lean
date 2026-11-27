import Inv08Install
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.ExpiryStorage
private theorem key (id : Nat) (fits : id<R) :
    mappingStorageSlotForKey 7 .uint256 (.word id) = .ok (mappingStorageSlot 7 id) := by
  simp [mappingStorageSlotForKey,coerceMappingKeyWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,
    show Shared.norm id=id from Nat.mod_eq_of_lt fits,Bind.bind,Except.bind]
private theorem lookup (c : Context) (fields : c.storageFields=model.core.context.storageFields) :
    c.storageField? "expiries" = some mappingField := by
  change c.storageFields.find? _ = _
  rw [fields]; exact fromGenerated
theorem loadRecord (c : Context) (r : Runtime) (id : Nat) (fit : id<R)
    (fields : c.storageFields=model.core.context.storageFields) :
    r.loadStorageIndex c "expiries" (.word id) = .ok (tuple r.state (mappingStorageSlot 7 id)) := by
  unfold Runtime.loadStorageIndex
  rw [lookup c fields]
  simp [mappingField,key id fit,whole,Bind.bind,Except.bind]

theorem storeRecord (c : Context) (r : Runtime) (id : Nat) (fit : id<R) (e : Record)
    (fields : c.storageFields=model.core.context.storageFields) :
    r.storeStorageIndexWithDeepClear c "expiries" (.word id) (.tuple e.words) =
      .ok {r with state := install r.state (mappingStorageSlot 7 id) e} := by
  have materialized : r.storageMaterializedValue (.tuple e.words) = .ok (.tuple e.words) := by
    simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Runtime.derefMemoryValuesWithFuel,Record.words,Bind.bind,Except.bind]
  unfold Runtime.storeStorageIndexWithDeepClear
  rw [lookup c fields]
  simp [materialized,mappingField,key id fit,tupleWrite,Bind.bind,Except.bind]

theorem readInstalled (c : Context) (r : Runtime) (id : Nat) (fit : id<R) (e : Record) (domain : Fits e)
    (fields : c.storageFields=model.core.context.storageFields) :
    let updated := {r with state := install r.state (mappingStorageSlot 7 id) e}
    r.storeStorageIndexWithDeepClear c "expiries" (.word id) (.tuple e.words) = .ok updated ∧
    updated.loadStorageIndex c "expiries" (.word id) = .ok (.tuple e.words) := by
  dsimp only
  exact ⟨storeRecord c r id fit e fields,(loadRecord _ _ _ fit fields).trans (congrArg Except.ok (installReads _ _ e domain))⟩
end Inv08.ExpiryStorage
