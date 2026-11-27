import Inv48WrapperTraversalSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def uintReturn : List Ty → Bool
  | [.uint256] => true
  | _ => false

def metadata := wrappers.all fun name =>
  (Inv48.Source.model.core.findFunctionByName? name).any fun fn =>
    fn.payable && uintReturn (fn.returns.map BindingDecl.ty)
theorem bothMetadata : metadata = true := by native_decide

end Inv48.WrapperTraversal
