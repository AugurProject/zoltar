import Inv48PublicShape
import Inv48LiquidationActualFundingBodies
open SolidCore.Solidity.Source Inv32Shapes
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
def libraryKey := "__internal___library_OraclePriceMath_liquidationPrice(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def libraryShape : Pattern Stmt := (Stmt_block (seq [(Stmt_assign (LValue_var (lit "price")) (Expr_castOp (CastKind_uintCleanup) (lit 256) (Expr_var (lit "price")))),(Stmt_assign (LValue_var (lit "uncertainty")) (Expr_castOp (CastKind_uintCleanup) (lit 256) (Expr_var (lit "uncertainty")))),(Stmt_skip),(Stmt_block (seq [(Stmt_requireStmt (Expr_binary (BinaryOp_lt) (Expr_castOp (CastKind_uintCleanup) (lit 256) (Expr_var (lit "uncertainty"))) (Expr_ternary (Expr_word (lit 1)) (Expr_word (lit 10000000)) (Expr_word (lit 10000000)))) (Option_some (lit "Invalid oracle uncertainty"))),(Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_0") Option_none),(Stmt_block (seq [(Stmt_varDecl (Ty_uint256) (lit "_ic_arg_0") (Option_some (Expr_castOp (CastKind_uintCleanup) (lit 256) (Expr_var (lit "price"))))),(Stmt_varDecl (Ty_uint256) (lit "_ic_arg_1") (Option_some (Expr_ternary (Expr_word (lit 1)) (Expr_word (lit 10000000)) (Expr_word (lit 10000000))))),(Stmt_varDecl (Ty_uint256) (lit "_ic_arg_2") (Option_some (Expr_castOp (CastKind_uintCleanup) (lit 256) (Expr_castOp (CastKind_uintCleanup) (lit 256) (Expr_binary (BinaryOp_add) (Expr_ternary (Expr_word (lit 1)) (Expr_word (lit 10000000)) (Expr_word (lit 10000000))) (Expr_castOp (CastKind_uintCleanup) (lit 256) (Expr_var (lit "uncertainty")))))))),(Stmt_varDecl (Ty_uint256) (lit "_ret___library_Math_mulDiv_0") Option_none),(Stmt_captureReturn (seq [(lit "_ret___library_Math_mulDiv_0")]) (Stmt_internalCall (seq [(lit "_ret___library_Math_mulDiv_0")]) (lit "__internal___library_Math_mulDiv(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]") (seq [(Expr_var (lit "_ic_arg_0")),(Expr_var (lit "_ic_arg_1")),(Expr_var (lit "_ic_arg_2"))]))),(Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "_ret___library_Math_mulDiv_0")))])),(Stmt_returnValues (seq [(Expr_castOp (CastKind_uintCleanup) (lit 256) (Expr_castOp (CastKind_uintCast) (lit 256) (Expr_var (lit "_sol_hoist_0"))))]))]))]))
theorem checked_library_body : ((Inv48.Source.model.core.table.lookup? libraryKey).map InternalFunction.body) = some actualLiquidationLibraryBody :=
  (Option_some libraryShape).sound _ (by native_decide)
theorem checked_body : ((Inv48.Source.model.core.findFunctionByName? "minimumToken1ReportAttoEthForPrice").map FunctionDef.body) = some actualMinimumBody := by
  exact Inv48.Public.checked_body
#print axioms checked_library_body
#print axioms checked_body
end GuardRecovery
