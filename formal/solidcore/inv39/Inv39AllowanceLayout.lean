import Inv39Mapping
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Allowance
def layout : StorageLayout := .mapping .address (.mapping .address (.scalar .uint256))
def descriptor : StorageField := {name:="_allowances",slot:=1,layout? := some layout}
private def matchesLayout : Option StorageField → Bool
  | some ⟨"_allowances",1,none,some (.mapping .address (.mapping .address (.scalar .uint256))),false,0,32,false⟩ => true | _ => false
private theorem decode (f : Option StorageField) (h : matchesLayout f) : f=some descriptor := by
  unfold matchesLayout at h; split at h <;> first | rfl | contradiction
theorem bound : model.core.context.storageField? "_allowances"=some descriptor := decode _ (by native_decide)
end Inv39.Allowance
