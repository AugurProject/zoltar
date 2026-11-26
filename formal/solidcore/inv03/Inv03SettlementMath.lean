import Inv27Generated
import Inv32FlagCalls

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Library
namespace Inv03

def checked := TypeCheck.CheckedInput.contract Inv27Generated.importedSourceUnit "InvariantMathHarness"
private theorem present : checked.toOption.isSome := by native_decide
def model := checked.toOption.get present

open Inv32Bodies.Mul512 in
theorem productLinked : Inv32Internal.ProductLinked model.core.table :=
  Inv32Internal.linkedOfCheck _ _ _ _ shape (by native_decide)
open Inv32Bodies.Floor in
theorem floorLinked : Inv32FloorCall.FloorLinked model.core.table :=
  Inv32Internal.linkedOfCheck _ _ _ _ shape (by native_decide)

open Inv32Bodies.Ceil in
theorem roundedLinked : LinkAt model.core.table key [.word "x",.word "y",.word "denominator",.word "rounding"]
    [.word "_ret0"] body :=
  linkAt _ _ _ _ _ (by native_decide) ((Inv32Shapes.Option_some shape).sound _ (by native_decide))
open Inv32Bodies.RoundsUp in
theorem roundsLinked : LinkAt model.core.table key [.word "rounding"] [.flag "_ret0"] body :=
  linkAt _ _ _ _ _ (by native_decide) ((Inv32Shapes.Option_some shape).sound _ (by native_decide))
open Inv32Bodies.ToUint in
theorem uintLinked : LinkAt model.core.table key [.flag "b"] [.word "u"] body :=
  linkAt _ _ _ _ _ (by native_decide) ((Inv32Shapes.Option_some shape).sound _ (by native_decide))

end Inv03
