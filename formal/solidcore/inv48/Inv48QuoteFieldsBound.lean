import Inv48QuoteBound
import Inv48QuoteMemoryFunding
namespace Inv48.QuoteMemory
private abbrev links := FeedBinding.generatedLinks
def generatedFundedQuote := fundedQuote links.1 links.2.1 links.2.2.2.1 links.2.2.2.2 links.2.2.1
#print axioms generatedFundedQuote
end Inv48.QuoteMemory
