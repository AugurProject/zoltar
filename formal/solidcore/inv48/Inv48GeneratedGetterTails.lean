import Inv48MinimaTableBindings
import Inv48MinimaTail
namespace Inv48.Minima
private abbrev bindings := TableCheck.generatedLinks
def generatedCollateralTail := collateralTailRun Inv48.Source.model.core.table bindings.2.2.1 bindings.2.2.2
def generatedRepTail := repTailRun Inv48.Source.model.core.table bindings.2.2.1 bindings.2.2.2
#print axioms generatedCollateralTail
#print axioms generatedRepTail
end Inv48.Minima
