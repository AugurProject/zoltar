import Inv12Model
import Inv12Allocation
import Inv32FloorCall
open SolidCore.Solidity.Source Inv32Division
namespace Inv12
open Inv32Bodies.Mul512 in
theorem productLinked : Inv32Internal.ProductLinked model.core.table :=
  Inv32Internal.linkedOfCheck _ _ _ _ shape (by native_decide)
open Inv32Bodies.Floor in
theorem floorLinked : Inv32FloorCall.FloorLinked model.core.table :=
  Inv32Internal.linkedOfCheck _ _ _ _ shape (by native_decide)

theorem coordinatorQuotient (n : Nat) (c : Context) (r : Runtime) (x y d : String) (targets : List String)
    (cash chosen total : Nat) (cf : cash<R) (tf : total<R) (pos : 0<total) (covered : chosen≤total)
    (a : r.lookupLocal? x=some (.word cash)) (b : r.lookupLocal? y=some (.word chosen))
    (den : r.lookupLocal? d=some (.word total)) :
    Stmt.eval (n+13) model.core.table c r (.internalCall targets Inv32Bodies.Floor.key [.var x,.var y,.var d]) =
      internalCallAssign r targets [.word (cash*chosen/total)] :=
  Inv32FloorCall.successAt _ productLinked floorLinked (n+12) c r x y d targets cash chosen total cf
    (lt_of_le_of_lt covered tf) tf pos (branchFits _ _ _ cf covered) a b den (by omega)

end Inv12
