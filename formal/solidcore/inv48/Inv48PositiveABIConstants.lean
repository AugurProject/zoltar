import Inv48PositiveSelector
open SolidCore.Solidity.Source
namespace Inv48.PositiveABI

theorem selector_value : ABI.selectorFromSignature signature = 4197127132 := by native_decide
#print axioms selector_value
end Inv48.PositiveABI
