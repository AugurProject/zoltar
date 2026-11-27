import Inv12Delta
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv12

def updateMember (name : String) (idx : Nat) (rhs : Pattern Expr) :=
  Stmt_exprStmt (Expr_assignment (Option_some BinaryOp_add) (Option_some (ValueCleanup_uint (lit 256)))
    (Inv08.Integral.member name idx) rhs)

def ledgerDelta := updateMember "fork" 5
  (clean (clean (Expr_binary BinaryOp_sub (member "branch" 6) (wvar "previousCash"))))

def ledgerStatements : Option (List Stmt) := do
  let fn ← model.core.findFunctionByName? "choose"
  let .block [_,_,.block [.block [_,_,.captureReturn [] (.block body),_]]] := fn.body | none
  let before := body.takeWhile (fun stmt => !missingGuard stmt)
  let afterGuard := body.drop (before.length+1)
  pure [← before.getLast?,← afterGuard[4]?]

theorem ledgerFromChoose : ledgerStatements=
    some [.exprStmt (addMember "branch" 5 (.var "commitment")), .exprStmt (addMember "fork" 5 deltaExpr)] :=
  (Option_some (seq [updateMember "branch" 5 (varP "commitment"),ledgerDelta])).sound _ (by native_decide)
end Inv12
