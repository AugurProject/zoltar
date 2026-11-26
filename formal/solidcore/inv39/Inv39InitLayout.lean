import Inv39InitDescriptors
namespace Inv39.Init
private theorem checked : [Key.universe,.number,.name,.symbol,.cap].all matchesKey := by native_decide
theorem layout (k : Key) : model.core.context.storageField? (name k)=some (field k) := by
  apply equivalent
  have eq := List.all_eq_true.mp checked k (by cases k <;> simp)
  simpa only [matchesKey,beq_iff_eq] using eq
end Inv39.Init
