import Inv48RoundedTableCheck
import Inv48QuoteExecCore
namespace Inv48.QuoteExec
private abbrev bindings := FeedBinding.generatedLinks
def generatedArithmetic := arithmetic bindings.1 bindings.2.1 bindings.2.2.2.1 bindings.2.2.2.2 bindings.2.2.1
def generatedCapture := capture bindings.1 bindings.2.1 bindings.2.2.2.1 bindings.2.2.2.2 bindings.2.2.1
#print axioms generatedArithmetic
#print axioms generatedCapture
end Inv48.QuoteExec
