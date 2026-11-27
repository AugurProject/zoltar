import Inv48BatchLoopClosureEntry
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchLoopClosure
open Inv48.BatchInputLoop
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def batchDecl (fn : FunctionDef) : BindingDecl :=
  fn.params[3]?.getD ⟨"batch",.uint256,false⟩
def metadataCheck : Bool := Inv48.OperationsWrapperArgs.wrapper.any fun fn =>
  (fn.params.drop 3).map BindingDecl.name == ["batch"]
theorem checkedMetadata : metadataCheck = true := by native_decide

end Inv48.BatchLoopClosure
