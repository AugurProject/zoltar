import Inv39Generated
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39
def checked := TypeCheck.CheckedInput.contract Inv39Generated.importedSourceUnit "ReputationToken"
private theorem present : checked.toOption.isSome := by native_decide
def model := checked.toOption.get present
end Inv39
