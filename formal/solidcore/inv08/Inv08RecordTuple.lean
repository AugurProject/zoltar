import Inv08ExpiryStorage
open SolidCore.Solidity.Source
namespace Inv08.ExpiryStorage

def tuple (s : State) (slot : Nat) := Value.tuple [
  .word (memberWord s slot 0),.word (memberWord s slot 1),.word (memberWord s slot 2),
  .word (memberWord s slot 3),.word (memberWord s slot 4)]

theorem whole (s : State) (slot : Nat) : s.loadStorageLayoutAt slot layout = .ok (tuple s slot) := by
  have depth : layout.depth = 2 := by native_decide
  rw [State.loadStorageLayoutAt,depth]
  simp [layout,field,State.loadStorageLayoutAtFuel,
    State.loadStructSlotsFuel,StorageLayout.cursorStep,StorageLayoutCursor.align,wordBytes,
    packedStorageValueFromWord?,Ty.storageValueFromWord?, Bind.bind,Except.bind,memberSlot,
    tuple,memberWord]

end Inv08.ExpiryStorage
