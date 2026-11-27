import Inv48OperationsPublicEntryBudget
import Inv48OperationsPublicEntryRaw
import Inv48OperationsWrapperArgsTail
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify
namespace Inv48.PostLoopJoin
open Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def suffix : List Stmt := [budgetGuard, gasHoist] ++ callbackPrefix ++
  [Inv48.OperationsWrapperArgs.limitP.value,
   .varDecl .uint256 "_sol_hoist_0" none, Inv48.OperationsWrapperArgs.requestP.value]

def suffixP := Inv32Shapes.seq [budgetP,gasHoistP,
  Inv48.OperationsWrapperArgs.P_Stmt_varDecl Inv32Shapes.Ty_uint256 (Inv32Shapes.lit "_sol_hoist_0") Inv32Shapes.Option_none,
  Inv48.OperationsWrapperArgs.getterP,Inv48.OperationsWrapperArgs.callbackP,
  Inv48.OperationsWrapperArgs.limitP,
  Inv48.OperationsWrapperArgs.P_Stmt_varDecl Inv32Shapes.Ty_uint256 (Inv32Shapes.lit "_sol_hoist_0") Inv32Shapes.Option_none,
  Inv48.OperationsWrapperArgs.requestP]
def suffixCheck := Inv48.OperationsWrapperArgs.wrapper.any fun fn =>
  suffixP.test ((Inv48.OperationsWrapperArgs.mainStatements fn).drop 5 |>.take 8)
theorem checkedSuffix : suffixCheck = true := by native_decide

theorem sourceSuffix (fn : FunctionDef) (found : Inv48.OperationsWrapperArgs.wrapper = some fn) :
    ((Inv48.OperationsWrapperArgs.mainStatements fn).drop 5).take 8 = suffix := by
  have h := checkedSuffix
  simp only [suffixCheck,found,Option.any_some] at h
  exact suffixP.sound _ h

end Inv48.PostLoopJoin
