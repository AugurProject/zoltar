import Inv48QuoteExecMath
import Inv32Hoist
import Inv48Dataflow
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32FloorFastPath
namespace Inv48.QuoteExec
variable {table : FunctionTable}
variable (productLinked : Inv32Internal.ProductLinked table)
variable (floorLinked : Inv32FloorCall.FloorLinked table)
variable (roundsLinked : Inv32Library.LinkAt table Inv32Bodies.RoundsUp.key
  [.word "rounding"] [.flag "_ret0"] Inv32Bodies.RoundsUp.body)
variable (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key
  [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body)
variable (roundedLinked : Inv32Library.LinkAt table Inv32Bodies.Ceil.key
  [.word "x",.word "y",.word "denominator",.word "rounding"] [.word "_ret0"] Inv32Bodies.Ceil.body)
include productLinked floorLinked roundsLinked uintLinked roundedLinked
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev a2 := "_ic_arg_2"
abbrev a3 := "_ic_arg_3"
abbrev tmp := "_ret___library_Math_mulDiv_overload_1_0"
def repAmount (collateral price : Nat) := Inv03.ceilQuot (collateral*price) (10^18)
def call : Stmt := .internalCall [tmp] Inv32Bodies.Ceil.key
  [.var a0,.var a1,.var a2,.var a3]

/-- Execution of the generated quote's arithmetic call, with no arithmetic-output premise. -/
theorem arithmetic (n : Nat) (c : Context) (r : Runtime) (collateral price : Nat)
    (hc : collateral<R) (hp : price<R) (fits : repAmount collateral price<R)
    (A : r.lookupLocal? a0 = some (.word collateral))
    (B : r.lookupLocal? a1 = some (.word price))
    (D : r.lookupLocal? a2 = some (.word (10^18)))
    (U : r.lookupLocal? a3 = some (.word 1)) :
    Stmt.eval (n+18) table c r call =
      internalCallAssign r [tmp] [.word (repAmount collateral price)] := by
  have H := Inv48.QuoteExecMath.roundedCall productLinked floorLinked roundsLinked uintLinked roundedLinked n c r a0 a1 a2 a3 [tmp]
    collateral price (10^18) true hc hp (by decide) (by decide)
    (by rw [Inv48.QuoteExecMath.roundedCeil _ _ _ (by decide)]; exact fits) A B D U
  rw [Inv48.QuoteExecMath.roundedCeil collateral price (10^18) (by decide)] at H
  exact H

/-- The capture writes the derived result to the compiler-generated return temporary. -/
theorem capture (n : Nat) (c : Context) (r next : Runtime) (collateral price : Nat)
    (hc : collateral<R) (hp : price<R) (fits : repAmount collateral price<R)
    (A : r.lookupLocal? a0 = some (.word collateral))
    (B : r.lookupLocal? a1 = some (.word price))
    (D : r.lookupLocal? a2 = some (.word (10^18)))
    (U : r.lookupLocal? a3 = some (.word 1))
    (write : r.assignLocal? tmp (.word (repAmount collateral price)) = some next) :
    Stmt.eval (n+19) table c r (.captureReturn [tmp] call) =
      pure (.normal next) := by
  exact Inv32Hoist.takeReturn (n+18) _ c r next tmp Inv32Bodies.Ceil.key
    [.var a0,.var a1,.var a2,.var a3] (repAmount collateral price)
    (arithmetic productLinked floorLinked roundsLinked uintLinked roundedLinked n c r collateral price hc hp fits A B D U) write

omit productLinked floorLinked roundsLinked uintLinked roundedLinked in
/-- Both the zero and nonzero price cases are covered: the divisor is fixed, positive precision. -/
theorem zeroPrice (collateral : Nat) : repAmount collateral 0 = 0 := by
  simp [repAmount,Inv03.ceilQuot]

#print axioms arithmetic
#print axioms capture
#print axioms zeroPrice
end Inv48.QuoteExec
