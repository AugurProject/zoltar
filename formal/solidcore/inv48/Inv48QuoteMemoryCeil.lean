import Inv48QuoteMemoryOps
import Inv32CeilHoist
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32Hoist Inv32FloorStart Inv32CeilFlags
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
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

/-- Full compiler hoist execution, deriving the REP amount from the checked
arithmetic certificate. Argument expression evaluation is the isolated premise. -/
theorem ceilHoist (n : Nat) (c : Context) (r : Runtime) (ex ey ed : Expr)
    (collateral price : Nat) (hc : collateral<R) (hp : price<R)
    (fits : Inv48.QuoteExec.repAmount collateral price<R)
    (inputs : Inputs c r h0 ex ey ed collateral price (10^18)) :
    Stmt.eval (n+20) table c (Inv32OneArg.store r h0 0) (Inv32CeilHoist.code ex ey ed) =
      pure (.normal (Inv32OneArg.store r h0 (Inv48.QuoteExec.repAmount collateral price))) := by
  let v := Inv48.QuoteExec.repAmount collateral price
  let st := fun o tmp => Inv32CeilHoist.stateC r o collateral price (10^18) tmp
  have call := Inv48.QuoteExec.arithmetic productLinked floorLinked roundsLinked uintLinked roundedLinked
    n c (st 0 0) collateral price hc hp fits rfl rfl rfl rfl
  have up : (st 0 0).assignLocal? Inv32CeilHoist.dest (.word v) = some (st 0 v) := by
    cases H : r.locals <;> dsimp [st,Inv32CeilHoist.stateC,Inv32CeilHoist.dest,Inv32CeilHoist.a3,h0] <;> write_temps
  have captured := takeReturn _ _ _ _ _ _ _ _ _ call up
  have cp : Stmt.evalList (n+19) table c (st 0 v)
      [.assign (.var h0) (.var Inv32CeilHoist.dest)] = pure (.normal (st v v)) := by
    apply lastCopy _ _ _ _ _ _ _ 0 v
    all_goals cases H : r.locals <;> dsimp [st,Inv32CeilHoist.stateC,Inv32CeilHoist.dest,Inv32CeilHoist.a3,h0] <;> write_temps
  have prefixStep := Inv32CeilHoist.args (n+18) table c r ex ey ed collateral price (10^18)
    [Inv32CeilHoist.cap,.assign (.var h0) (.var Inv32CeilHoist.dest)] inputs
  exact block _ _ _ _ _ _ (prefixStep.trans ((seqStep _ _ _ _ _ _ _ captured).trans cp))

#print axioms ceilHoist
end Inv48.QuoteMemory
