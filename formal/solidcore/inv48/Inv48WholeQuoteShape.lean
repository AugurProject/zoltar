import Inv48WholeQuoteSyntax
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
open QuoteMemory
def checkedBody := (Option_some bodyP).test
  ((Source.model.core.table.lookup? quoteKey).map InternalFunction.body)
theorem bodyCertified : checkedBody = true := by native_decide

theorem actualBody : (Source.model.core.table.lookup? quoteKey).map InternalFunction.body = some bodyP.value :=
  (Option_some bodyP).sound _ bodyCertified

#print axioms actualBody
end Inv48.WholeQuote
