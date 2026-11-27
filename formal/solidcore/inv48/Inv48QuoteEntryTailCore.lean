import Inv48QuoteFundingFieldsFunding
import Inv48WholeQuoteFundingStage
import Inv48FundingMathTailScopes
import Inv48CloneGettersWrappers
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.QuoteEntryTail
open Inv48.QuoteMemory Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def start (physical : Runtime) (p a bounty : Nat) := prepared physical p a bounty
def funded (physical : Runtime) (p a bounty : Nat) :=
  Inv48.WholeQuote.funded (start physical p a bounty) physical.nextMemory a p

theorem fundingExecution (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (hp : p<R) (ha : a<R) (fits : Inv48.QuoteExec.repAmount a p<R) :
    Stmt.evalList (n+20) Inv48.Source.model.core.table c (start physical p a bounty)
      ((actualStatements.drop 1).take 4) = pure (.normal (funded physical p a bounty)) := by
  rw [Inv48.QuoteFundingFields.actualFundingSlice]
  exact initializedFunding Inv48.FeedMath.productLinked Inv48.FeedMath.floorLinked
    Inv48.FeedMath.roundsLinked Inv48.FeedMath.uintLinked Inv48.FeedMath.roundedLinked
    n c physical p a bounty hp ha fits

theorem fundingEntry (physical : Runtime) (p a bounty : Nat) :
    Inv48.FundingMathTail.FundingEntry (funded physical p a bounty) physical.nextMemory a
      (Inv48.QuoteExec.repAmount a p) := by
  constructor
  · exact Nat.lt_succ_self physical.nextMemory
  · apply funding_frame
    exact (store_other _ _ "quote" (by decide)).trans (allocated_ref physical p a bounty)

theorem concreteScopes (physical : Runtime) (p a bounty : Nat) :
    (funded physical p a bounty).locals =
      [(Inv32CeilFlags.h0,.word (Inv48.QuoteExec.repAmount a p))] :: [] ::
      (allocated physical p a bounty).locals := rfl

theorem sourceSegments : actualStatements =
    [minP.value] ++ ((actualStatements.drop 1).take 4) ++ actualStatements.drop 5 := by
  rw [Inv48.QuoteFundingFields.actualInterior]
  rfl
def quoteTypeP : Inv32Shapes.Pattern Ty where
  value := quoteTy
  test | .tuple [.uint256,.uint256,.uint256,.uint256,.uint256] => true | _ => false
  sound v h := by split at h <;> first | rfl | contradiction

def returnP := Inv32Shapes.seq [Inv48.CloneGetters.binding "quote" quoteTypeP]
def returnCheck := (Inv32Shapes.Option_some returnP).test
  ((Inv48.Source.model.core.table.lookup? quoteKey).map InternalFunction.returns)
theorem returnCertified : returnCheck = true := by native_decide

theorem registeredReturns :
    (Inv48.Source.model.core.table.lookup? quoteKey).map InternalFunction.returns =
      some [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩] :=
  (Inv32Shapes.Option_some returnP).sound _ returnCertified
end Inv48.QuoteEntryTail
