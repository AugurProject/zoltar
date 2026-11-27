import Inv12Ref
import Inv12Model
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def mappedMembers (name : String) : Option (Nat × List StorageLayout) := do
  let field ← model.core.context.storageField? name
  let .mapping .uint256 (.struct members) ← field.layout? | none
  pure (field.slot,members)

def wordOffset (members : List StorageLayout) (i : Nat) : Option Nat := do
  let (off,.packedScalar 0 32 false .uint256) ← StorageLayouts.fieldOffsetAndLayout?
    (Shared.norm (Shared.norm i)) 0 members | none
  pure off

def mappedOffsets (name : String) (indices : List Nat) : Option (Nat × List Nat) := do
  let (slot,members) ← mappedMembers name
  pure (slot,← indices.mapM (wordOffset members))

theorem registeredOffsets :
    mappedOffsets "forks" [1,2,5,6] = some (2,[1,2,5,6]) ∧
    mappedOffsets "branchStates" [4,5,6] = some (3,[3,4,5]) := by native_decide

theorem fieldOfOffset (r : Ref) (i off : Nat) (h : wordOffset r.members i=some off) :
    r.hasField i off := by
  unfold wordOffset at h
  cases eqn : StorageLayouts.fieldOffsetAndLayout? (Shared.norm (Shared.norm i)) 0 r.members with
  | none => simp [eqn] at h
  | some p =>
    obtain ⟨n,l⟩ := p
    simp only [eqn,Bind.bind,Option.bind] at h
    split at h <;> simp_all [Ref.hasField,Pure.pure]

end Inv12
