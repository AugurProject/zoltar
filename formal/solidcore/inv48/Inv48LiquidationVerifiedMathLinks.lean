import Inv48Model
import Inv32FloorHoist
open SolidCore.Solidity.Source
namespace LiquidationLibrary.MathLinks
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
open Inv32Bodies.Mul512 in
theorem product : Inv32Internal.ProductLinked Inv48.Source.model.core.table :=
  Inv32Internal.linkedOfCheck _ _ _ _ shape (by native_decide)
open Inv32Bodies.Floor in
theorem floor : Inv32FloorCall.FloorLinked Inv48.Source.model.core.table :=
  Inv32Internal.linkedOfCheck _ _ _ _ shape (by native_decide)
#print axioms product
#print axioms floor
end LiquidationLibrary.MathLinks
