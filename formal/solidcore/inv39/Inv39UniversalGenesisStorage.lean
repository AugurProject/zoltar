import Inv39UniversalGenesisBody
import Inv39UniversalGenesisShort
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.UniversalGenesis
set_option maxRecDepth 20000
set_option maxHeartbeats 0
private theorem emptyRead (b slot : Nat) :
    ({State.empty with selfBalance:=b} : State).loadSlot slot=0 := by
  simp [State.loadSlot,State.empty,StorageMap.lookup?]
/-- The entry-balance rebase cannot affect the two fresh short-string writes. -/
theorem freshMetadataStorage (b : Nat) : (Symbolic.freshMetadata b).storage=seed.storage := by
  have first (k : Nat) :
      ({State.empty with selfBalance:=k}.storeStorageBytesAt 3 [82,101,112,117,116,97,116,105,111,110])=
      ({State.empty with selfBalance:=k}.storeSlot 3
        (storageBytesShortWord ([82,101,112,117,116,97,116,105,111,110].map normByte))) :=
    shortWrite _ _ _ (by decide) (emptyRead k 3)
  have second (k : Nat) :
      ({State.empty with selfBalance:=k}.storeSlot 3
        (storageBytesShortWord ([82,101,112,117,116,97,116,105,111,110].map normByte))).loadSlot 4=0 := by
    rw [loadUnchanged _ _ _ _ (by decide)]
    exact emptyRead k 4
  change (Symbolic.freshMetadata b).storage=(Symbolic.freshMetadata 0).storage
  unfold Symbolic.freshMetadata
  rw [first b,first 0]
  rw [shortWrite _ 4 [82,69,80] (by decide) (second b),
    shortWrite _ 4 [82,69,80] (by decide) (second 0)]
  rfl
#print axioms freshMetadataStorage
end Inv39.UniversalGenesis
