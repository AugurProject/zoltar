import Inv08ReleaseQuote
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08
inductive Field | ethCursor | repCursor | duration | ethOut | repOut | through | settled | latest | ethDeferred | repDeferred
def Field.name : Field → String
  | .ethCursor => "lastEthIntegralNumerator" | .repCursor => "lastRepIntegralNumerator"
  | .duration => "rewardDuration" | .ethOut => "outstandingEth" | .repOut => "outstandingRep"
  | .through => "releasedThrough" | .settled => "releasedExpiryId" | .latest => "lastExpiryId"
  | .ethDeferred => "deferredEth" | .repDeferred => "deferredRep"
def Field.slot : Field → Nat
  | .ethCursor => 5 | .repCursor => 6 | .ethOut => 1 | .repOut => 2
  | .ethDeferred => 3 | .repDeferred => 4 | _ => 0
def Field.offset : Field → Nat
  | .duration => 18 | .settled => 12 | .latest => 6 | _ => 0
def Field.width : Field → Nat
  | .duration | .through | .settled | .latest => 6 | _ => 32
def Field.field (k : Field) : StorageField :=
  { name := k.name, slot := k.slot, ty? := some .uint256, layout? := some (.scalar .uint256),
    packedOffset := k.offset, packedBytes := k.width }
private def matchesField (k : Field) : Option StorageField → Bool
  | some ⟨name, slot, some .uint256, some (.scalar .uint256), false, off, width, false⟩ =>
    name == k.name && slot == k.slot && off == k.offset && width == k.width
  | _ => false
private theorem decode (k : Field) (f : Option StorageField) (h : matchesField k f) : f = some k.field := by
  unfold matchesField at h
  split at h
  · simp only [Bool.and_eq_true, beq_iff_eq] at h
    obtain ⟨⟨⟨rfl,rfl⟩,rfl⟩,rfl⟩ := h
    rfl
  · contradiction
theorem fieldLookup (k : Field) : model.core.context.storageField? k.name=some k.field := by
  apply decode
  cases k <;> native_decide
def stored (s : State) (k : Field) := s.loadFieldWord k.field
theorem reads (c : Context) (r : Runtime) (k : Field) (fields : c.storageFields=model.core.context.storageFields) :
    Inv40.Reads c r (.storageRead .ref k.name []) (stored r.state k) := by
  have lookup : c.storageField? k.name=some k.field := by
    change c.storageFields.find? _ = _
    rw [fields]; exact fieldLookup k
  have word : r.loadStorageField c k.name=.ok (.word (stored r.state k)) := by
    unfold Runtime.loadStorageField
    rw [lookup]
    rfl
  intro fuel enough
  cases fuel with
  | zero => simp [Expr.orderFuel] at enough
  | succ n =>
    rw [Expr.evalFuel]
    change (do let v ← liftM (r.loadStorageField c k.name); pure (v,r)) = _
    rw [word]; rfl
end Inv08
