import Inv12Generated
open SolidCore.Solidity
namespace Inv12
def checked := TypeCheck.CheckedInput.contract Target57_4.importedSourceUnit "SecurityPoolForkCoordinator"
private theorem present : checked.toOption.isSome := by native_decide
def model := checked.toOption.get present
end Inv12
