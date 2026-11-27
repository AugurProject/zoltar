import Inv48RoundedTableCheck
import Inv32FlagCalls
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Library
namespace Inv48.FeedMath
open Inv48.Source
set_option maxHeartbeats 4000000
set_option maxRecDepth 16384

private abbrev links := FeedBinding.generatedLinks

open Inv32Bodies.Mul512 in
theorem productLinked : Inv32Internal.ProductLinked model.core.table :=
  links.1
open Inv32Bodies.Floor in
theorem floorLinked : Inv32FloorCall.FloorLinked model.core.table :=
  links.2.1

open Inv32Bodies.Ceil in
theorem roundedLinked : LinkAt model.core.table key [.word "x",.word "y",.word "denominator",.word "rounding"]
    [.word "_ret0"] body :=
  links.2.2.1
open Inv32Bodies.RoundsUp in
theorem roundsLinked : LinkAt model.core.table key [.word "rounding"] [.flag "_ret0"] body :=
  links.2.2.2.1
open Inv32Bodies.ToUint in
theorem uintLinked : LinkAt model.core.table key [.flag "b"] [.word "u"] body :=
  links.2.2.2.2

end Inv48.FeedMath
