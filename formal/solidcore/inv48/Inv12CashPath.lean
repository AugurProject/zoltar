import Inv12CallbackShape
import Inv12ChoiceHistoryFrame
open SolidCore.Solidity.Source Inv03.Bodies Inv32Shapes
namespace Inv12

/-- The uninterrupted part of public choose from saving the branch quota through the fork ledger update. -/
def choiceCashPath : Option (List Stmt) := do
  let fn ← model.core.findFunctionByName? "choose"
  let .block [_,_,.block [.block [_,_,.captureReturn [] (.block body),_]]] := fn.body | none
  let count := (body.takeWhile (fun s => !missingGuard s)).length
  pure ((body.drop (count-3)).take 9)

theorem cashPathChecked : choiceCashPath=some (creditPrefix.value++[.block callbackCode,.exprStmt (addMember "fork" 5 deltaExpr)]) :=
  (Option_some (seq [decl "previousCash" (Option_some (member "branch" 6)),
    updateMember "branch" 4 (varP "rep"),updateMember "branch" 5 (varP "commitment"),
    Stmt_requireStmt (Expr_binary Inv08.Authority.neOp (member "fork" 1) (Expr_word (lit 0))) (Option_some (lit "Fork commitment missing")),
    decl tmp Option_none,quotient,writeCash,callbackPattern,ledgerDelta])).sound _ (by native_decide)
end Inv12
