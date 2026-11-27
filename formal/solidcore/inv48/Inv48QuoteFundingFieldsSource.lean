import Inv48WholeQuoteShape
open SolidCore.Solidity.Source
namespace Inv48.QuoteFundingFields
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- Direct indexed writes only. Calls are deliberately not treated as framed
by this checker; their heap effects need a separate semantic argument. -/
def directQuoteWrites : Nat → Stmt → List Nat
  | 0,_ => []
  | k+1,.block ss => ss.flatMap (directQuoteWrites k)
  | k+1,.ifElse _ a b => directQuoteWrites k a ++ directQuoteWrites k b
  | _+1,.assign (.index (.var "quote") (.word i)) _ => [i]
  | _,_ => []

theorem generatedDirectWrites :
    directQuoteWrites 100 Inv48.WholeQuote.bodyP.value = [0,1,2,2,3,4] := by native_decide

theorem generatedTailWrites :
    directQuoteWrites 100 (.block (Inv48.WholeQuote.interiorP.value.drop 5)) = [2,2,3,4] := by
  native_decide

/-- This concerns the registered function, not a surrogate body. -/
theorem registeredDirectWrites (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn) :
    directQuoteWrites 100 fn.body = [0,1,2,2,3,4] := by
  have shape := Inv48.WholeQuote.actualBody
  change Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn at linked
  rw [linked] at shape
  have eq := Option.some.inj shape
  rw [eq]
  exact generatedDirectWrites

/-- Recover the interior from the registered source certificate. -/
theorem actualInterior : Inv48.QuoteMemory.actualStatements = Inv48.WholeQuote.interiorP.value := by
  have shape := Inv48.WholeQuote.actualBody
  unfold Inv48.QuoteMemory.actualStatements
  cases found : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey with
  | none => rw [found] at shape; cases shape
  | some fn =>
    rw [found] at shape
    have body := Option.some.inj shape
    dsimp only
    rw [body]
    rfl

theorem actualFundingSlice :
    (Inv48.QuoteMemory.actualStatements.drop 1).take 4 =
      Inv48.QuoteMemory.collateralWrite :: Inv48.QuoteMemory.fundingCode := by
  rw [actualInterior]
  rfl

#print axioms registeredDirectWrites
end Inv48.QuoteFundingFields
