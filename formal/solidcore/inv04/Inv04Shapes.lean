import Inv03Bodies
open SolidCore.Solidity.Source Inv03.Bodies Inv32Shapes
namespace Inv04.Shapes
def ceilKey := "__internal___library_Math_ceilDiv(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def requiredKey := "__internal___library_SecurityPoolSettlementMath_requiredCash(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"
def double (x : Pattern Expr) := clean (clean x)
def pred := double (Expr_binary BinaryOp_sub (wvar "a") (num 1))
def div := double (Expr_binary BinaryOp_div pred (wvar "b"))
def factor := double (Expr_binary BinaryOp_add div (num 1))
def panic := block [block [decl "_ic_arg_0" (Option_some (Expr_ternary (num 1) (num 18) (num 18))),
  Stmt_captureReturn (seq []) (Stmt_internalCall (seq []) (lit Inv32Bodies.Panic.key) (seq [varP "_ic_arg_0"]))]]
def convert := block [Stmt_varDecl Ty_bool (lit "_ic_arg_0") (Option_some (Expr_binary BinaryOp_gt (wvar "a") (num 0))),
  decl Inv32CeilFlags.toU Option_none,Stmt_captureReturn (seq [lit Inv32CeilFlags.toU]) (Stmt_internalCall
    (seq [lit Inv32CeilFlags.toU]) (lit Inv32Bodies.ToUint.key) (seq [varP "_ic_arg_0"])),assign tmp (varP Inv32CeilFlags.toU)]
def ceilShape := block [param "a",param "b",Stmt_skip,block [
  Stmt_ifElse (Expr_binary BinaryOp_eq (wvar "b") (num 0)) panic Stmt_skip,
  Stmt_unchecked (block [decl "_sol_hoist_1" (Option_some factor),decl tmp Option_none,convert,
    ret (double (Expr_binary BinaryOp_mul copied (wvar "_sol_hoist_1")))])]]
def viewName := "#view3815"
def carry := "#operand3816"
def sum := "#operand3817"
def scale := "#operand3818"
def rawScale := assign scale (num (10^9))
def requiredShape := block [param "units",param "numerator",param "denominator",param "remainder",Stmt_skip,block [
  block [decl tmp Option_none,mulDiv (wvar "units") (wvar "numerator") (wvar "denominator") (enumWord 1),
    decl viewName (Option_some copied),decl carry (Option_some (wvar "remainder")),
    decl sum (Option_some (double (Expr_binary BinaryOp_add (wvar viewName) (wvar carry)))),
    decl scale Option_none,Stmt_ifElse (num 1) rawScale rawScale,decl tmp Option_none,
    hoist ceilKey "_ret___library_Math_ceilDiv_0" [("_ic_arg_0",wvar sum),("_ic_arg_1",wvar scale)],ret copied]]]

theorem ceilLinked : Inv32Library.LinkAt Inv03.model.core.table ceilKey [.word "a",.word "b"] [.word "_ret0"] ceilShape.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some ceilShape).sound _ (by native_decide))
theorem requiredLinked : Inv32Library.LinkAt Inv03.model.core.table requiredKey
    [.word "units",.word "numerator",.word "denominator",.word "remainder"] [.word "_ret0"] requiredShape.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some requiredShape).sound _ (by native_decide))
end Inv04.Shapes
