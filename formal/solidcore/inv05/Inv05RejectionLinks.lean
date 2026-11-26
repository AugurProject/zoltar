import Inv03SettlementMath
import Inv32RejectionLinks
open SolidCore.Solidity.Source
namespace Inv05
def rejectionLinks : Inv32Rejection.Links Inv03.model.core.table :=
  ⟨Inv03.productLinked,Inv03.floorLinked,Inv03.uintLinked,
   Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Inv32Shapes.Option_some Inv32Bodies.Ternary.shape).sound _ (by native_decide)),
   Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Inv32Shapes.Option_some Inv32Bodies.Panic.shape).sound _ (by native_decide))⟩
end Inv05
