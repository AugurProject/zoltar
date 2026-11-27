import Inv48Generated
import Inv32Library
open SolidCore.Solidity
namespace Inv48.Source
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def checked := TypeCheck.CheckedInput.contract Target77_2.importedSourceUnit "SharedPoolPriceFeed"
theorem present : checked.toOption.isSome = true := by native_decide
def model := checked.toOption.get present

theorem checked_ok : checked = .ok model := by
  have extract (c : Except TypeCheck.TypeError TypeCheck.CheckedContract) (h : c.toOption.isSome) :
      c = .ok (c.toOption.get h) := by
    cases c with
    | ok _ => rfl
    | error _ => contradiction
  exact extract checked present
end Inv48.Source
