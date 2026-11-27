import Inv48Model
import Inv48PositiveTernaryFormula
namespace Inv48.PositiveTernary
open SolidCore.Solidity.Source
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem linked : Inv32Library.LinkAt Inv48.Source.model.core.table Inv32Bodies.Ternary.key
    [.flag "condition",.word "a",.word "b"] [.word "_ret0"] Inv32Bodies.Ternary.body :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide)
    ((Inv32Shapes.Option_some Inv32Bodies.Ternary.shape).sound _ (by native_decide))

end Inv48.PositiveTernary
