import Inv48WholeQuoteComposition
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
open QuoteMemory

theorem initializedFunding {table : FunctionTable}
    (productLinked : Inv32Internal.ProductLinked table)
    (floorLinked : Inv32FloorCall.FloorLinked table)
    (roundsLinked : Inv32Library.LinkAt table Inv32Bodies.RoundsUp.key
      [.word "rounding"] [.flag "_ret0"] Inv32Bodies.RoundsUp.body)
    (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key
      [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body)
    (roundedLinked : Inv32Library.LinkAt table Inv32Bodies.Ceil.key
      [.word "x",.word "y",.word "denominator",.word "rounding"] [.word "_ret0"] Inv32Bodies.Ceil.body)
    (n : Nat) (c : Context) (base : Runtime) (p a bounty : Nat)
    (hp : p<R) (ha : a<R) (hr : QuoteExec.repAmount a p<R) :
    Stmt.evalList (n+20) table c (prepared base p a bounty) (collateralWrite :: fundingCode) =
      pure (.normal (funded (prepared base p a bounty) base.nextMemory a p)) := by
  exact fundedQuote productLinked floorLinked roundsLinked uintLinked roundedLinked n c
    (prepared base p a bounty) base.nextMemory 0 0 0 0 0 a p
    (allocated_ref base p a bounty) (allocated_memory base p a bounty) (by rfl) (by rfl) ha hp hr

#print axioms initializedFunding
end Inv48.WholeQuote
