import Inv48WholeQuoteShape
import Inv48WholeQuoteRefine
namespace Inv48.WholeQuote
/-- Specialization to the exact generated _quoteReportFunding body and fresh
Math table links. Oracle/helper transcripts, numeric bounds, primitive reads,
floor arguments and named binding metadata remain explicit in the type. -/
private abbrev links := FeedBinding.generatedLinks
def generatedWholeQuote := wholeQuote links.1 links.2.1 links.2.2.2.1 links.2.2.2.2 links.2.2.1 actualBody
#print axioms generatedWholeQuote
end Inv48.WholeQuote
