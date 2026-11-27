import Inv12ChosenQuota
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv12

def creditPrefix := seq [decl "previousCash" (Option_some (member "branch" 6)),
  updateMember "branch" 4 (varP "rep"),updateMember "branch" 5 (varP "commitment"),
  Stmt_requireStmt (Expr_binary Inv08.Authority.neOp (member "fork" 1) (Expr_word (lit 0))) (Option_some (lit "Fork commitment missing")),
  decl tmp Option_none,quotient,writeCash]

def choiceCreditCode : Option (List Stmt) := do
  let fn ← model.core.findFunctionByName? "choose"
  let .block [_,_,.block [.block [_,_,.captureReturn [] (.block body),_]]] := fn.body | none
  let k := (body.takeWhile (fun s => !missingGuard s)).length
  pure ((body.drop (k-3)).take 7)

theorem creditFromChoose : choiceCreditCode=some creditPrefix.value :=
  (Option_some creditPrefix).sound _ (by native_decide)
end Inv12
