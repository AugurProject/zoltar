import Inv48QuoteFundingFieldsFrame
import Inv48QuoteFundingFieldsSource
import Inv48FeedMathLinks
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteFundingFields
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- Inversion of successful execution of the actual generated funding slice.
The output is derived using the verified Math implementation, not assumed.
Numeric input/range conditions remain explicit. -/
theorem fundingSlice (n : Nat) (c : Context) (r : Runtime)
    (id oldA oldB h e s a p : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (Inv48.QuoteMemory.tuple oldA oldB h e s))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (ha : a < Inv32Division.R) (hp : p < Inv32Division.R)
    (fits : Inv48.QuoteExec.repAmount a p < Inv32Division.R)
    (tr : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes
      (Stmt.evalList (n+20) Inv48.Source.model.core.table c r
        ((Inv48.QuoteMemory.actualStatements.drop 1).take 4)) tr (.ok out)) :
    ∃ final, out = .normal final ∧ Fields final id a (Inv03.ceilQuot (a*p) (10^18)) := by
  rw [actualFundingSlice] at run
  have step := Inv48.QuoteMemory.fundedQuote
    Inv48.FeedMath.productLinked Inv48.FeedMath.floorLinked
    Inv48.FeedMath.roundsLinked Inv48.FeedMath.uintLinked Inv48.FeedMath.roundedLinked
    n c r id oldA oldB h e s a p ref mem A P ha hp fits
  change Stmt.evalList _ _ _ _ (Inv48.QuoteMemory.collateralWrite :: _) = _ at step
  rw [step] at run
  cases run
  exact ⟨_,rfl,h,e,s,Inv48.QuoteMemory.put_load _ _ _ _ _ _ _⟩

#print axioms fundingSlice
end Inv48.QuoteFundingFields
