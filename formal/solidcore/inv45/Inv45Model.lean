import Inv45Generated
open SolidCore.Solidity
namespace Inv45
def checked := TypeCheck.CheckedInput.contract Target18_0.importedSourceUnit "ZoltarQuestionData"
private theorem existsChecked : checked.toOption.isSome := by native_decide
def model := checked.toOption.get existsChecked
end Inv45
