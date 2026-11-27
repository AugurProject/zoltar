import Inv48OperationsPublicEntrySearch
import Inv48BatchLoopClosureDecode
import Inv48WrapperTraversalRaw
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.WrapperTraversal
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
def outerStatements (fn : FunctionDef) : List Stmt :=
  match fn.body with | .block ss => ss | _ => []
def prefixesCheck := Inv48.OperationsWrapperArgs.wrapper.any fun fn =>
  Inv48.WrapperTraversal.prefixes Inv48.Source.model.core.table ((outerStatements fn).take 5) &&
  Inv48.WrapperTraversal.prefixes Inv48.Source.model.core.table ((Inv48.OperationsWrapperArgs.mainStatements fn).take 4)
theorem checkedPrefixes : prefixesCheck = true := by native_decide

theorem validationSafe : safe 100 Inv48.Source.model.core.table
    Inv48.OperationsWrapperArgs.loopP.value = true := by native_decide
end Inv48.OperationsPublicEntry
