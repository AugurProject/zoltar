import Inv44Generated
open SolidCore.Solidity
namespace Inv44
def checked := TypeCheck.CheckedInput.contract Target6_0.importedSourceUnit "DeploymentStatusOracle"
private theorem present : checked.toOption.isSome := by native_decide
def model := checked.toOption.get present
end Inv44
