import Inv08SearchExpressions
import Inv08ExpiryStorage
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Expiry

/-- The uint48 end field is member zero of the struct at keccak256(id, slot 7). -/
def endsAt (s : State) (id : Nat) := ExpiryStorage.memberWord s (mappingStorageSlot 7 id) 0

theorem records (c : Context) (s : State) (last : Nat) (domain : last < 2^48)
    (fields : c.storageFields = model.core.context.storageFields) : EndTable c s (endsAt s) last := by
  intro r id same bound
  have fit : id<R := lt_trans (lt_of_le_of_lt bound domain) (by decide)
  have lookup : c.storageField? "expiries" = some ExpiryStorage.mappingField := by
    change c.storageFields.find? _ = _
    rw [fields]; exact ExpiryStorage.fromGenerated
  have key : mappingStorageSlotForKey 7 .uint256 (.word id) = .ok (mappingStorageSlot 7 id) := by
    simp [mappingStorageSlotForKey,coerceMappingKeyWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,
      show SolidCore.Solidity.Shared.norm id=id from Nat.mod_eq_of_lt fit,Bind.bind,Except.bind]
  have anchor : r.storageBaseAnchor c (.field "expiries") [.word id,.word 0] =
      .ok (7,.mapping .uint256 ExpiryStorage.layout) := by
    simp [Runtime.storageBaseAnchor,lookup,ExpiryStorage.mappingField,Bind.bind,Except.bind,Pure.pure,Except.pure]
  have path : r.resolveStorageBasePath c (.field "expiries") [.word id,.word 0] =
      r.resolveStorageBasePath c (.slot (mappingStorageSlot 7 id) ExpiryStorage.layout) [.word 0] := by
    unfold Runtime.resolveStorageBasePath
    rw [anchor]
    change r.state.resolveStoragePathSlot 7 (.mapping .uint256 ExpiryStorage.layout) [.word id,.word 0] = _
    rw [State.resolveStoragePathSlot,key]
    rfl
  rw [show r.loadStorageBasePath c (.field "expiries") [.word id,.word 0] =
      r.loadStorageBasePath c (.slot (mappingStorageSlot 7 id) ExpiryStorage.layout) [.word 0] by
      unfold Runtime.loadStorageBasePath; rw [path]]
  rw [←same]
  exact ExpiryStorage.load c r _ 0
theorem endFits (s : State) (id : Nat) : endsAt s id<2^48 := by
  change SolidCore.Solidity.Shared.norm (_ % 2^48) < 2^48
  have low (n : Nat) : SolidCore.Solidity.Shared.norm (n % 2^48) < 2^48 := by
    have small := Nat.mod_lt n (by decide : 0<2^48)
    rwa [show SolidCore.Solidity.Shared.norm (n % 2 ^ 48) = n % 2^48 from Nat.mod_eq_of_lt (lt_trans small (by decide))]
  exact low _
end Inv08.Expiry
