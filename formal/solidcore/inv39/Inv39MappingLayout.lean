import Inv39SupplyFields
import Inv39BalanceSlots
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
def balanceField : StorageField :=
  {name:="_balances",slot:=0,layout? := some (.mapping .address (.scalar .uint256))}
private def matchesBalances : Option StorageField → Bool
  | some ⟨"_balances",0,none,some (.mapping .address (.scalar .uint256)),false,0,32,false⟩ => true
  | _ => false
private theorem sound (f) (h : matchesBalances f) : f=some balanceField := by
  unfold matchesBalances at h; split at h <;> first | rfl | contradiction
theorem balanceLayout : model.core.context.storageField? "_balances" = some balanceField :=
  sound _ (by native_decide)
end Inv39
