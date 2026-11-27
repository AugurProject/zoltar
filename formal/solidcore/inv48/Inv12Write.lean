import Inv12Storage
import Inv08RecordReadback
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def putAmount (s : State) (slot offset v : Nat) : State :=
  let dest := normWord (Shared.norm slot+offset)
  s.storeSlot dest (wordReplaceBitRange 0 256 (s.loadSlot dest) (Shared.norm v))

theorem writeAmount (c : Context) (r : Runtime) (slot index offset v : Nat) (layout : List StorageLayout)
    (field : StorageLayouts.fieldOffsetAndLayout? (Shared.norm (Shared.norm index)) 0 layout =
      some (offset,.packedScalar 0 32 false .uint256)) :
    r.storeStorageBasePathWithDeepClear c (.slot slot (.struct layout)) [.word index] (.word v) =
      .ok {r with state:=putAmount r.state slot offset v} := by
  have loc : r.resolveStorageBasePath c (.slot slot (.struct layout)) [.word index] =
      .ok (normWord (Shared.norm slot+offset),.packedScalar 0 32 false .uint256) := by
    simp [Runtime.resolveStorageBasePath,Runtime.storageBaseAnchor,State.resolveStoragePathSlot,Value.expectWord,
      structFieldStorageSlot?,field,Bind.bind,Except.bind]
  unfold Runtime.storeStorageBasePathWithDeepClear
  have material : r.storageMaterializedValue (.word v)=.ok (.word v) := by
    simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel]
  simp [material,loc,Bind.bind,Except.bind,State.storeStorageLayoutAtWithDeepClear,StorageLayout.clearDepth,
    State.storeStorageLayoutAtWithDeepClearFuelMode,State.storeStorageLayoutAt,coerceStorageWordAs,
    Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,putAmount]

theorem amountAfter (s : State) (slot off v : Nat) (fit : v<Inv32Division.R) :
    amountAt (putAmount s slot off v) slot off=v := by
  unfold amountAt putAmount
  rw [Inv08.slotAfter,if_pos rfl]
  exact Inv08.ExpiryStorage.bitReadback _ _ _ (by decide) fit (by decide)

theorem otherAmount (s : State) (slot off v other j : Nat)
    (sep : Shared.norm (normWord (Shared.norm slot+off))≠Shared.norm (normWord (Shared.norm other+j))) :
    amountAt (putAmount s slot off v) other j=amountAt s other j := by
  unfold amountAt putAmount
  rw [Inv08.slotAfter,if_neg sep]

end Inv12
