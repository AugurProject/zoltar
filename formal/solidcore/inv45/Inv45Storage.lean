import Inv45Observed
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes
namespace Inv45.Public
def labelsField : StorageField :=
  {name:="outcomeLabels",slot:=1,layout?:=some (.mapping .uint256 (.dynamicArray .string))}
def questionLayout : StorageLayout := .struct [.string,.string,.packedScalar 0 6 false .uint256,
  .packedScalar 6 6 false .uint256,.packedScalar 12 15 false .uint256,
  .packedScalar 0 32 true .int256,.packedScalar 0 32 true .int256,.string]
def questionField : StorageField :=
  {name:="questions",slot:=2,layout?:=some (.mapping .uint256 questionLayout)}
def labelsShape : Pattern (Option StorageField) where
  value:=some labelsField
  test
    | some ⟨"outcomeLabels",1,none,some (.mapping .uint256 (.dynamicArray .string)),false,0,32,false⟩=>true
    | _=>false
  sound v h:=by split at h <;> simp_all [labelsField,wordBytes]
def questionShape : Pattern (Option StorageField) where
  value:=some questionField
  test
    | some ⟨"questions",2,none,some (.mapping .uint256 (.struct [.string,.string,.packedScalar 0 6 false .uint256,
      .packedScalar 6 6 false .uint256,.packedScalar 12 15 false .uint256,
      .packedScalar 0 32 true .int256,.packedScalar 0 32 true .int256,.string])),false,0,32,false⟩=>true
    | _=>false
  sound v h:=by split at h <;> simp_all [questionField,questionLayout,wordBytes]
theorem labelsRegistered : model.core.context.storageField? "outcomeLabels"=some labelsField := labelsShape.sound _ (by native_decide)
theorem questionRegistered : model.core.context.storageField? "questions"=some questionField := questionShape.sound _ (by native_decide)
theorem registered (c : Context) (fields : c.storageFields=model.core.storageFields) :
    c.storageField? "outcomeLabels"=some labelsField ∧ c.storageField? "questions"=some questionField := by
  constructor
  · change c.storageFields.find? _=_;rw [fields];exact labelsRegistered
  · change c.storageFields.find? _=_;rw [fields];exact questionRegistered
#print axioms registered
end Inv45.Public
