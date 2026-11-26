import Inv45Storage
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv45.Public

def labelsSlot (question : Nat) := mappingStorageSlot 1 (Shared.norm question)
def lengthExpr : Source.Expr := .length (.storageRead .element "outcomeLabels" [.var "questionId"])

theorem lengthStorage (c : Context) (r : Runtime) (question : Nat)
    (field : c.storageField? "outcomeLabels"=some labelsField) :
    r.loadStorageBaseLength c (.field "outcomeLabels") [.word question]=.ok (.word (r.state.loadSlot (labelsSlot question))) := by
  have anchor : r.storageBaseAnchor c (.field "outcomeLabels") [.word question]=
      .ok (1,.mapping .uint256 (.dynamicArray .string)) := by
    simp [Runtime.storageBaseAnchor,field,labelsField,Bind.bind,Except.bind,Pure.pure,Except.pure]
  unfold Runtime.loadStorageBaseLength Runtime.resolveStorageBasePath
  rw [anchor]
  rfl

theorem lengthReads (c : Context) (r : Runtime) (question : Nat) (fields : c.storageFields=model.core.storageFields)
    (look : r.lookupLocal? "questionId"=some (.word question)) :
    Inv40.Reads c r lengthExpr (r.state.loadSlot (labelsSlot question)) := by
  intro fuel enough
  change 5≤fuel at enough
  obtain ⟨m,rfl⟩ := Nat.exists_eq_add_of_le' enough
  unfold lengthExpr
  rw [Expr.evalFuel]
  change (do let (dest,next) ← Expr.resolveLValueFuel (m+4) c r (.storageRead .element "outcomeLabels" [.var "questionId"])
             match dest.asStoragePath? with
             | some (base,indices) => do let v ← liftM (next.loadStorageBaseLength c base indices);pure (v,next)
             | none => throw (SolidityFailure.revert RevertData.typeMismatch))=_
  rw [Expr.resolveLValueFuel,Inv32Guards.readWord _ _ _ _ _ look]
  change (do let v ← liftM (r.loadStorageBaseLength c (.field "outcomeLabels") [.word question]);pure (v,r) : SolI (Source.Value × Runtime))=_
  rw [lengthStorage _ _ _ (registered c fields).1];rfl
  all_goals intros;rename_i impossible;cases impossible
#print axioms lengthReads
end Inv45.Public
