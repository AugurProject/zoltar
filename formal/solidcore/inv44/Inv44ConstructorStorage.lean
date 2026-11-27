import Inv44ConstructorShape
import Inv08StorageUpdate
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44.Constructor
def cells (s : State) (start : Nat) : List Nat → State
  | [] => s
  | x::xs => cells (s.storeSlot (slot start) (Shared.norm x)) (start+1) xs

def install (xs : List Nat) (s : State) := (cells s 0 xs).storeSlot 0 xs.length

private def writeCell (s : State) (p : Nat × Value) : Except RevertData State := do
  let (i, val) := p
  let (key,kind) ← match dynamicArrayLayoutStorageSlotAndLayout? 0 i (.scalar .address) with
    | some pair => Except.ok pair | none => Except.error RevertData.typeMismatch
  match s.storeWideSignedArrayCopyElement? key kind val (signExtend:=true) with
  | some ans => ans
  | none => s.storeStorageLayoutAtWithDeepClearFuelMode true 1 key kind val

private theorem nextCell (s : State) (i x : Nat) (fit : i<R) :
    writeCell s (i,.word x)=.ok (s.storeSlot (slot i) (Shared.norm x)) := by
  have loc : dynamicArrayLayoutStorageSlotAndLayout? 0 i (.scalar .address)=some (slot i,.scalar .address) := by
    simp [dynamicArrayLayoutStorageSlotAndLayout?,StorageLayout.arrayElementOffsetAndLayout?,StorageLayout.slotSpan,
      slot,show Shared.norm i=i from Nat.mod_eq_of_lt fit,Bind.bind,Option.bind]
  simp [writeCell,loc,State.storeWideSignedArrayCopyElement?,State.storeStorageLayoutAtWithDeepClearFuelMode,
    State.storeStorageLayoutAt,coerceStorageWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,Bind.bind,Except.bind]

private theorem writeCells (xs : List Nat) (s : State) (i : Nat) (cap : i+xs.length≤256) :
    ((List.range' i xs.length).zip (xs.map Value.word)).foldlM writeCell s=.ok (cells s i xs) := by
  induction xs generalizing s i with
  | nil => rfl
  | cons x xs ih =>
    have fit : i<R := lt_of_le_of_lt (by omega : i≤256) (by decide)
    simp only [List.length_cons,List.range'_succ,List.map_cons,List.zip_cons_cons,List.foldlM_cons,cells,
      nextCell _ _ _ fit,Bind.bind,Except.bind]
    exact ih _ _ (by simp at cap; omega)

theorem storeArray (s : State) (xs : List Nat) (empty : s.loadSlot 0=0) (cap : xs.length≤256) :
    s.storeStorageLayoutAtWithDeepClear 0 (.dynamicArray (.scalar .address)) (array xs) = .ok (install xs s) := by
  rw [State.storeStorageLayoutAtWithDeepClear]
  change State.storeStorageLayoutAtWithDeepClearFuelMode true 2 s 0 (.dynamicArray (.scalar .address)) (.dynamicArray (xs.map Value.word))=_
  rw [State.storeStorageLayoutAtWithDeepClearFuelMode] <;> try simp
  simp only [empty,show Shared.norm 0=0 from rfl,Nat.not_lt_zero,if_false]
  change (do let t ← ((List.range xs.length).zip (xs.map Value.word)).foldlM writeCell s
             pure (t.storeSlot 0 xs.length)) = _
  rw [List.range_eq_range',writeCells xs s 0 (by simpa using cap)]
  rfl
end Inv44.Constructor
