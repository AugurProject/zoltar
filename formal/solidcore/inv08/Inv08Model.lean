import Inv08Generated
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv08
def checked := TypeCheck.CheckedInput.contract Inv08Generated.importedSourceUnit "SecurityPoolCapitalFeeStreams"
private theorem present : checked.toOption.isSome := by native_decide
def model := checked.toOption.get present
end Inv08
