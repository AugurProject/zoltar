import Inv08Members
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12
def amountAt (s : State) (slot offset : Nat) := wordBitRange 0 256 (s.loadSlot (normWord (Shared.norm slot+offset)))

theorem amountField (c : Context) (r : Runtime) (slot index offset : Nat) (layout : List StorageLayout)
    (field : StorageLayouts.fieldOffsetAndLayout? (Shared.norm (Shared.norm index)) 0 layout =
      some (offset,.packedScalar 0 32 false .uint256)) :
    r.loadStorageBasePath c (.slot slot (.struct layout)) [.word index]=.ok (.word (amountAt r.state slot offset)) := by
  simp [Runtime.loadStorageBasePath,Runtime.resolveStorageBasePath,Runtime.storageBaseAnchor,
    State.resolveStoragePathSlot,Value.expectWord,structFieldStorageSlot?,Bind.bind,Except.bind,Pure.pure,Except.pure,
    field,Option.bind,State.loadStorageLayoutAt,State.loadStorageLayoutAtFuel,packedStorageValueFromWord?,
    Ty.storageValueFromWord?,amountAt]

theorem readAmount (c : Context) (r : Runtime) (name : String) (slot index offset : Nat) (layout : List StorageLayout)
    (small : index<Inv32Division.R) (bound : r.lookupStorageBase? name=some (.slot slot (.struct layout)))
    (field : StorageLayouts.fieldOffsetAndLayout? (Shared.norm (Shared.norm index)) 0 layout =
      some (offset,.packedScalar 0 32 false .uint256)) :
    Inv40.Reads c r (Inv08.Integral.member name index).value (amountAt r.state slot offset) :=
  Inv08.Integral.memberReads _ _ _ _ _ _ _ small bound (amountField _ _ _ _ _ _ field)
end Inv12
