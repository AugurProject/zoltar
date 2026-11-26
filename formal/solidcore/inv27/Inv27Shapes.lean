import Inv27Bounds
import Inv03FeeSteps
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv27
def key (cons : Bool) := "__internal___library_OraclePriceMath_" ++ (if cons then "conservativePrice" else "liquidationPrice") ++ "(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def precision := Expr_ternary (num 1) (num D) (num D)
def arithmetic (op : Pattern BinaryOp) := clean (clean (Expr_binary op precision (wvar "uncertainty")))
def guard := Stmt_requireStmt (Expr_binary BinaryOp_lt (wvar "uncertainty") precision) (Option_some (lit "Invalid oracle uncertainty"))
def priceGuard := Stmt_requireStmt (Expr_binary BinaryOp_le (wvar "price") (wvar "maximumPrice"))
  (Option_some (lit "Conservative oracle price exceeds uint256"))
def floor (x y d : Pattern Expr) := hoist Inv32Bodies.Floor.key Inv32FloorHoist.ret
  [(Inv32FloorHoist.a0,x),(Inv32FloorHoist.a1,y),(Inv32FloorHoist.a2,d)]
def body (cons : Bool) := block [param "price",param "uncertainty",Stmt_skip,block (
  [guard,decl tmp Option_none] ++ (if cons then [
    floor (clean (num M)) (arithmetic BinaryOp_sub) precision,
    decl "maximumPrice" (Option_some copied),priceGuard,decl tmp Option_none,
    mulDiv (wvar "price") precision (arithmetic BinaryOp_sub) (enumWord 1)]
    else [floor (wvar "price") precision (arithmetic BinaryOp_add)]) ++ [ret copied])]
theorem linked (cons : Bool) : Inv32Library.LinkAt Inv03.model.core.table (key cons)
    [.word "price",.word "uncertainty"] [.word "_ret0"] (body cons).value :=
  Inv32Library.linkAt _ _ _ _ _ (by cases cons <;> native_decide)
    ((Option_some (body cons)).sound _ (by cases cons <;> native_decide))
end Inv27
