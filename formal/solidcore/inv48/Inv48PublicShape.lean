import Inv48Model
import Inv32Shapes
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.Public
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def BinaryOp_ne : Pattern BinaryOp where
  value := .ne
  test | .ne => true | _ => false
  sound v h := by cases v <;> simp_all

def Expr_immutable (p : Pattern String) : Pattern Expr where
  value := .immutable p.value
  test | .immutable name => p.test name | _ => false
  sound v h := by
    cases v <;> try contradiction
    next name => exact congrArg Expr.immutable (p.sound name h)

def shape : Pattern Stmt :=
(Stmt_block (seq [(Stmt_assign (LValue_var (lit "proposedRepPerEthPrice")) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "proposedRepPerEthPrice")))),
(Stmt_skip),
(Stmt_block (seq [(Stmt_requireStmt (Expr_binary BinaryOp_ne (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "proposedRepPerEthPrice"))) (Expr_word (lit 0))) (Option_some (lit "Initial oracle price zero"))),
(Stmt_block (seq [
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none),
(Stmt_block (seq [
(Stmt_varDecl Ty_uint256 (lit "_ic_arg_0") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "proposedRepPerEthPrice"))))),
(Stmt_varDecl Ty_uint256 (lit "_ic_arg_1") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_immutable (lit "targetPriceErrorForDispute"))))),
(Stmt_varDecl Ty_uint256 (lit "_ret___library_OraclePriceMath_liquidationPrice_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret___library_OraclePriceMath_liquidationPrice_0")]) (Stmt_internalCall (seq [(lit "_ret___library_OraclePriceMath_liquidationPrice_0")]) (lit "__internal___library_OraclePriceMath_liquidationPrice(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]") (seq [(Expr_var (lit "_ic_arg_0")),(Expr_var (lit "_ic_arg_1"))]))),
(Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "_ret___library_OraclePriceMath_liquidationPrice_0")))])),
(Stmt_varDecl Ty_uint256 (lit "#view47500") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCast (lit 256) (Expr_var (lit "_sol_hoist_0")))))),
(Stmt_requireStmt (Expr_binary BinaryOp_ne (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#view47500"))) (Expr_word (lit 0))) (Option_some (lit "Oracle liquidation price is zero")))])),
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_ret_minimumToken1ReportAttoEth_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret_minimumToken1ReportAttoEth_0")]) (Stmt_internalCall (seq [(lit "_ret_minimumToken1ReportAttoEth_0")]) (lit "__internal_minimumToken1ReportAttoEth()#[]") (seq []))),
(Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "_ret_minimumToken1ReportAttoEth_0")))])),
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_1") Option_none),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_ret_minimumToken2ReportAttoRep_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret_minimumToken2ReportAttoRep_0")]) (Stmt_internalCall (seq [(lit "_ret_minimumToken2ReportAttoRep_0")]) (lit "__internal_minimumToken2ReportAttoRep()#[]") (seq []))),
(Stmt_assign (LValue_var (lit "_sol_hoist_1")) (Expr_var (lit "_ret_minimumToken2ReportAttoRep_0")))])),
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_2") Option_none),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_ic_arg_0") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "_sol_hoist_1"))))),
(Stmt_varDecl Ty_uint256 (lit "_ic_arg_1") (Option_some (Expr_ternary (Expr_word (lit 1)) (Expr_word (lit 1000000000000000000)) (Expr_word (lit 1000000000000000000))))),
(Stmt_varDecl Ty_uint256 (lit "_ic_arg_2") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "proposedRepPerEthPrice"))))),
(Stmt_varDecl Ty_uint256 (lit "_ic_arg_3") (Option_some (Expr_enumFromUInt (lit 3) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_word (lit 1)))))),
(Stmt_varDecl Ty_uint256 (lit "_ret___library_Math_mulDiv_overload_1_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret___library_Math_mulDiv_overload_1_0")]) (Stmt_internalCall (seq [(lit "_ret___library_Math_mulDiv_overload_1_0")]) (lit "__internal___library_Math_mulDiv_overload_1(uint256,uint256,uint256,uint8)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.enum { segments := [\"Math\", \"Rounding\"] } 3]") (seq [(Expr_var (lit "_ic_arg_0")),
(Expr_var (lit "_ic_arg_1")),
(Expr_var (lit "_ic_arg_2")),
(Expr_var (lit "_ic_arg_3"))]))),
(Stmt_assign (LValue_var (lit "_sol_hoist_2")) (Expr_var (lit "_ret___library_Math_mulDiv_overload_1_0")))])),
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_3") Option_none),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_ic_arg_0") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "_sol_hoist_0"))))),
(Stmt_varDecl Ty_uint256 (lit "_ic_arg_1") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCast (lit 256) (Expr_var (lit "_sol_hoist_2")))))),
(Stmt_varDecl Ty_uint256 (lit "_ret___library_Math_max_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret___library_Math_max_0")]) (Stmt_internalCall (seq [(lit "_ret___library_Math_max_0")]) (lit "__internal___library_Math_max(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]") (seq [(Expr_var (lit "_ic_arg_0")),
(Expr_var (lit "_ic_arg_1"))]))),
(Stmt_assign (LValue_var (lit "_sol_hoist_3")) (Expr_var (lit "_ret___library_Math_max_0")))])),
(Stmt_returnValues (seq [(Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCast (lit 256) (Expr_var (lit "_sol_hoist_3"))))]))]))]))

def body := shape.value

theorem checked_body :
    ((Inv48.Source.model.core.findFunctionByName? "minimumToken1ReportAttoEthForPrice").map FunctionDef.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
#print axioms checked_body
end Inv48.Public
