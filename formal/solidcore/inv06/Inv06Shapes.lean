import Inv03Bodies
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv06.Shapes
def netKey := "__internal___library_SecurityPoolSettlementMath_netCash(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def cashKey := "__internal___library_SecurityPoolSettlementMath_cashForUnits(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"
def netRet := "_ret___library_SecurityPoolSettlementMath_netCash_0"
def viewName := "#view3718"
def cap := clean (clean (num (2^128)))
def capTest := Expr_binary BinaryOp_lt (wvar "cash") (Expr_ternary (num 1) cap cap)
def value := clean (clean (Expr_binary BinaryOp_sub (scaledUnits "cash") (wvar "remainder")))
def netShape := block [param "cash",param "remainder",Stmt_skip,block [
  Stmt_requireStmt capTest (Option_some (lit "Settlement cash too large")),ret value]]
def netCall := hoist netKey netRet [(Inv32FloorHoist.a0,wvar "cash"),(Inv32FloorHoist.a1,wvar "remainder")]
def partialBody := block [decl tmp Option_none,netCall,decl viewName (Option_some (wvar tmp)),decl tmp Option_none,
  call4 rawKey rawRet (wvar "burned") (wvar viewName) (wvar "units") (enumWord 0),ret (wvar tmp)]
def cashShape := block [param "cash",param "units",param "remainder",param "burned",Stmt_skip,block [
  Stmt_ifElse (Expr_binary BinaryOp_eq (wvar "burned") (num 0)) (ret (num 0)) Stmt_skip,
  Stmt_ifElse (Expr_binary BinaryOp_eq (wvar "burned") (wvar "units")) (ret (wvar "cash")) partialBody]]
theorem netLinked : Inv32Library.LinkAt Inv03.model.core.table netKey [.word "cash",.word "remainder"]
    [.word "_ret0"] netShape.value := Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some netShape).sound _ (by native_decide))
theorem cashLinked : Inv32Library.LinkAt Inv03.model.core.table cashKey [.word "cash",.word "units",.word "remainder",.word "burned"]
    [.word "_ret0"] cashShape.value := Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some cashShape).sound _ (by native_decide))
end Inv06.Shapes
