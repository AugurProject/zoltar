import Inv08Members
open SolidCore.Solidity.Source
namespace Inv08.ExpiryStorage
def field (bytes : Nat) := StorageLayout.packedScalar 0 bytes false .uint256
def layout := StorageLayout.struct [field 6,field 32,field 32,field 32,field 32]
def mappingField : StorageField := {name := "expiries",slot := 7,layout? := some (.mapping .uint256 layout)}
private def same : Option StorageField → Bool
  | some ⟨"expiries",7,none,some (.mapping .uint256 (.struct [
    .packedScalar 0 6 false .uint256,.packedScalar 0 32 false .uint256,.packedScalar 0 32 false .uint256,
    .packedScalar 0 32 false .uint256,.packedScalar 0 32 false .uint256])),false,0,32,false⟩ => true
  | _ => false
private theorem sameSound (f : Option StorageField) (h : same f) : f = some mappingField := by
  unfold same at h
  split at h <;> first | rfl | contradiction
theorem fromGenerated : model.core.context.storageField? "expiries" = some mappingField :=
  sameSound _ (by native_decide)

def memberSlot (slot i : Nat) := normWord (SolidCore.Solidity.Shared.norm slot + i)
def memberWord (s : State) (slot i : Nat) := wordBitRange 0 (if i=0 then 48 else 256) (s.loadSlot (memberSlot slot i))

def memberBytes (i : Nat) := if i=0 then 6 else 32
private def offsetMatches (i : Nat) : Option (Nat × StorageLayout) → Bool
  | some (n,.packedScalar 0 w false .uint256) => n == i && w == memberBytes i
  | _ => false
private theorem offsetSound (i : Nat) (o : Option (Nat × StorageLayout)) (h : offsetMatches i o) :
    o = some (i,field (memberBytes i)) := by
  unfold offsetMatches at h
  split at h
  · simp only [Bool.and_eq_true,beq_iff_eq] at h
    obtain ⟨rfl,rfl⟩ := h
    rfl
  · contradiction
private theorem offset (i : Fin 5) :
    StorageLayouts.fieldOffsetAndLayout? (SolidCore.Solidity.Shared.norm (SolidCore.Solidity.Shared.norm i.val))
      0 [field 6,field 32,field 32,field 32,field 32] = some (i.val,field (memberBytes i)) := by
  apply offsetSound
  obtain ⟨i,lt⟩ := i
  have cases : i=0 ∨ i=1 ∨ i=2 ∨ i=3 ∨ i=4 := by omega
  rcases cases with rfl | rfl | rfl | rfl | rfl <;> dsimp only <;> native_decide

theorem load (c : Context) (r : Runtime) (slot : Nat) (i : Fin 5) :
    r.loadStorageBasePath c (.slot slot layout) [.word i.val] = .ok (.word (memberWord r.state slot i)) := by
  have atSlot := offset i
  simp [Runtime.loadStorageBasePath,Runtime.resolveStorageBasePath,Runtime.storageBaseAnchor,
    State.resolveStoragePathSlot,layout,Value.expectWord,structFieldStorageSlot?,Bind.bind,Except.bind,
    Pure.pure,Except.pure,atSlot,field,Option.bind,State.loadStorageLayoutAt,State.loadStorageLayoutAtFuel,
    packedStorageValueFromWord?,Ty.storageValueFromWord?,memberWord,memberSlot] at *
  all_goals split <;> simp_all [memberBytes]

theorem bindRecord (c : Context) (r : Runtime) (id : Nat) (fit : id < Inv32Division.R)
    (fields : c.storageFields = model.core.context.storageFields) :
    r.bindStorageRef c (.field "expiries") [.word id] =
      .ok (.storageSlotRef (mappingStorageSlot 7 id) layout) := by
  have lookup : c.storageField? "expiries" = some mappingField := by
    change c.storageFields.find? _ = _
    rw [fields]; exact fromGenerated
  have key : mappingStorageSlotForKey 7 .uint256 (.word id) = .ok (mappingStorageSlot 7 id) := by
    simp [mappingStorageSlotForKey,coerceMappingKeyWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,
      show SolidCore.Solidity.Shared.norm id=id from Nat.mod_eq_of_lt fit,Bind.bind,Except.bind]
  simp [Runtime.bindStorageRef,Runtime.resolveStorageBasePath,Runtime.storageBaseAnchor,lookup,mappingField,
    State.resolveStoragePathSlot,key,Bind.bind,Except.bind,Pure.pure,Except.pure]

theorem memberReads (c : Context) (r : Runtime) (name : String) (slot : Nat) (i : Fin 5)
    (bound : r.lookupStorageBase? name = some (.slot slot layout)) :
    Inv40.Reads c r (Integral.member name i).value (memberWord r.state slot i) :=
  Integral.memberReads c r name _ _ _ _ (lt_trans i.isLt (by decide)) bound (load c r slot i)
end Inv08.ExpiryStorage
