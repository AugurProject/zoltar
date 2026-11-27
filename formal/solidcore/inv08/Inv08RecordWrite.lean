import Inv08RecordTuple
import Inv08StorageUpdate
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.ExpiryStorage
structure Record where
  endAt : Nat
  ethRate : Nat
  repRate : Nat
  ethWeighted : Nat
  repWeighted : Nat

def Record.words (e : Record) : List Source.Value :=
  [.word e.endAt,.word e.ethRate,.word e.repRate,.word e.ethWeighted,.word e.repWeighted]

def storeMember (s : State) (slot i v : Nat) : State :=
  let dest := memberSlot slot i
  s.storeSlot dest (wordReplaceBitRange 0 (if i=0 then 48 else 256) (s.loadSlot dest) (Shared.norm v))

def install (s : State) (slot : Nat) (e : Record) : State :=
  let first := storeMember s slot 0 e.endAt
  let second := storeMember first slot 1 e.ethRate
  let third := storeMember second slot 2 e.repRate
  let fourth := storeMember third slot 3 e.ethWeighted
  storeMember fourth slot 4 e.repWeighted

theorem tupleWrite (s : State) (slot : Nat) (e : Record) :
    s.storeStorageLayoutAtWithDeepClear slot layout (.tuple e.words) = .ok (install s slot e) := by
  have depth : layout.clearDepth = 2 := by native_decide
  rw [State.storeStorageLayoutAtWithDeepClear,depth]
  simp [layout,field,Record.words,State.storeStorageLayoutAtWithDeepClearFuelMode,
    State.storeStorageLayoutAt, List.foldlM, coerceStorageWordAs, Value.forceAbiLazy,
    Ty.coerceValue?,Value.asStorageWord?,StorageLayout.cursorStep,wordBytes,
    Bind.bind, Except.bind, Pure.pure,Except.pure,install,storeMember,memberSlot]

end Inv08.ExpiryStorage
