import Inv12Recovery
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv12

private def firstRecoveryWrite : Option Stmt := do
  let [fn] := model.core.table.filter (fun f => f.name.contains "__internal__recoveryQuestion(") | none
  let .block [_,_,_,.block body] := fn.body | none
  let some (.ifElse _ (.block (_ :: statement :: _)) _) := body.find? (fun | .ifElse .. => true | _ => false) | none
  pure statement

theorem recoveryFromCoordinator : firstRecoveryWrite=some neutralWrite.value :=
  (Option_some neutralWrite).sound _ (by native_decide)
end Inv12
