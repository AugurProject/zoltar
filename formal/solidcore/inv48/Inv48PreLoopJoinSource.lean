import Inv48PreLoopJoinSourceCertificate
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.PreLoopJoin
open Inv48.OperationsWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem actualPrefixes (fn : FunctionDef) (found : wrapper = some fn) :
    (Inv48.OperationsPublicEntry.outerStatements fn).take 5 = cleanPrefix ∧
    (mainStatements fn).take 4 = initialPrefix := by
  have h := checkedPrefixes
  simp only [prefixCheck,found,Option.any_some,Bool.and_eq_true] at h
  exact ⟨cleanP.sound _ h.1,initialP.sound _ h.2⟩

theorem firstRead : Read first := by
  change Read (.binary .ge _ _)
  repeat' constructor
  all_goals intro h; cases h
theorem secondRead : Read second := by
  apply Read.and
  all_goals
    apply Read.binary
    all_goals first | (intro h; cases h) | (repeat' constructor)
theorem thirdRead : Read third := by
  change Read (.binary .ne _ _)
  repeat' constructor
  all_goals intro h; cases h
end Inv48.PreLoopJoin
