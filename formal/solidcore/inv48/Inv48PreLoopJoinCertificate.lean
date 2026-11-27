import Inv48OperationsPublicEntryRaw
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PreLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

def batchCleanup (fn : FunctionDef) : AbiCleanup := fn.paramAbiCleanups[3]?.getD .none
def decodeMetadataCheck := Inv48.OperationsWrapperArgs.wrapper.any fun fn =>
  Inv48.SimpleWrapperArgs.abiCleanupsP.test (fn.paramAbiCleanups.take 3) &&
  ((fn.paramAbiCleanups.drop 3).length == 1) && ABI.AbiCleanup.decodeLazy (batchCleanup fn)
theorem checkedDecodeMetadata : decodeMetadataCheck = true := by native_decide

end Inv48.PreLoopJoin
