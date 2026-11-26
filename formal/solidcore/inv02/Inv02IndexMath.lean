import Inv01Generated
import Inv32FloorCall

open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv02

def checked := TypeCheck.CheckedInput.contract Inv01Generated.importedSourceUnit "SecurityPoolCommitmentIndex"
private theorem present : checked.toOption.isSome = true := by native_decide
def indexModel := checked.toOption.get present

theorem productLinked : Inv32Internal.ProductLinked indexModel.core.table :=
  Inv32Internal.linkedOfCheck _ _ _ _ Inv32Bodies.Mul512.shape (by native_decide)

theorem floorLinked : Inv32FloorCall.FloorLinked indexModel.core.table :=
  Inv32Internal.linkedOfCheck _ _ _ _ Inv32Bodies.Floor.shape (by native_decide)

end Inv02
