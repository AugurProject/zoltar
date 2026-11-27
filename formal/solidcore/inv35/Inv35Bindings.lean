import Inv35Execution
import Inv32Shapes
open SolidCore.Solidity.Source Inv32Shapes Inv32Dispatch
namespace Inv35Source
private def varP (s : String) := Expr_var (lit s)
private def cleanP (e : Pattern Expr) := Expr_castOp CastKind_uintCleanup (lit 256) e
private def cleanVar (s : String) := cleanP (varP s)
private def assignP (s : String) := Stmt_assign (LValue_var (lit s))
private def param (s : String) := assignP s (cleanVar s)
private def declare (s : String) := Stmt_varDecl Ty_uint256 (lit s)
private def blockP (ss : List (Pattern Stmt)) := Stmt_block (seq ss)
private def positive (s : String) := Expr_binary BinaryOp_gt (cleanVar s) (Expr_word (lit 0))
private def captured (dst callee : String) (args : List String) :=
  let targets := seq [lit dst]
  Stmt_captureReturn targets (Stmt_internalCall targets (lit callee) (seq (args.map varP)))
private def entry (body : List (Pattern Stmt)) := blockP [param "yesReserve",param "noReserve",Stmt_skip,blockP body]
private def bodyShape := entry [
  Stmt_requireStmt (Expr_binary BinaryOp_boolOr (positive "yesReserve") (positive "noReserve")) (Option_some (lit "Empty reserves")),
  declare flag Option_none, blockP [
    declare a0 (Option_some (Expr_ternary (Expr_word (lit 1)) (Expr_word (lit 10000)) (Expr_word (lit 10000)))),
    declare a1 (Option_some (cleanVar "noReserve")),declare a2 (Option_some (cleanVar "yesReserve")),
    declare ret Option_none,captured ret Inv32Bodies.Ratio.key [a0,a1,a2],assignP flag (varP ret)],
  Stmt_returnValues (seq [cleanVar flag])]
theorem linked : Inv32Library.Link key [.word "yesReserve",.word "noReserve"] [.word "_ret0"] code := by
  apply Inv32Library.link _ _ _ _ (by native_decide)
  exact (Option_some bodyShape).sound _ (by native_decide)

abbrev spotRet := "_ret___library_TwoWayConstantProductMath_conditionalYesBps_0"
def wrapperShape := entry [declare flag Option_none,blockP [
  declare a0 (Option_some (cleanVar "yesReserve")),declare a1 (Option_some (cleanVar "noReserve")),
  declare spotRet Option_none,captured spotRet key [a0,a1],assignP flag (varP spotRet)],
  Stmt_returnValues (seq [cleanP (Expr_castOp CastKind_uintCast (lit 256) (varP flag))])]
def fn := (model.core.findFunctionByName? "conditionalYesBps").get (by native_decide)
theorem wrapperBody : fn.body = wrapperShape.value := wrapperShape.sound _ (by native_decide)
end Inv35Source
