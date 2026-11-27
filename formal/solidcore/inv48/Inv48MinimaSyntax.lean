import Inv32Library
import Inv48MinimaOracle
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.Minima
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def Expr_immutable (p : Pattern String) : Pattern Expr where
  value := .immutable p.value
  test | .immutable n => p.test n | _ => false
  sound v h := by split at h <;> first | (simp only [p.sound _ h]) | contradiction

def oracleRepPattern : Pattern Stmt :=
  ⟨readWord (oracleData repSelector "#view47475"), fun
   | .tryExternalCall .staticcall (.immutable "securityPool")
      (.encode .withSelector (some (.word 2328446634)) [] [.uint256] [.castOp .uintCast 248 (.var "#view47475")])
      (.word 0) none false false [⟨"__ext0",.uint256,false⟩] [.uint 256]
      (.assign (.var "_sol_hoist_0") (.castOp .uintCleanup 256 (.var "__ext0"))) [] => true
   | _ => false, by intro s h; dsimp only at h; split at h <;> first | rfl | contradiction⟩

def collateralPattern : Pattern Stmt :=
(Stmt_block (seq [(Stmt_skip),
(Stmt_block (seq [(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "#operand47452") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_immutable (lit "minimumReportCollateral"))))),
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_ret_aggregateExposureAttoEth_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret_aggregateExposureAttoEth_0")]) (Stmt_internalCall (seq [(lit "_ret_aggregateExposureAttoEth_0")]) (lit "__internal_aggregateExposureAttoEth()#[]") (seq []))),
(Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "_ret_aggregateExposureAttoEth_0")))])),
(Stmt_varDecl Ty_uint256 (lit "#view47456") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "_sol_hoist_0"))))),
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_ic_arg_0") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#view47456"))))),
(Stmt_varDecl Ty_uint256 (lit "_ic_arg_1") (Option_some (Expr_ternary (Expr_word (lit 1)) (Expr_word (lit 100)) (Expr_word (lit 100))))),
(Stmt_varDecl Ty_uint256 (lit "_ret___library_Math_ceilDiv_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret___library_Math_ceilDiv_0")]) (Stmt_internalCall (seq [(lit "_ret___library_Math_ceilDiv_0")]) (lit "__internal___library_Math_ceilDiv(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]") (seq [(Expr_var (lit "_ic_arg_0")),
(Expr_var (lit "_ic_arg_1"))]))),
(Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "_ret___library_Math_ceilDiv_0")))])),
(Stmt_varDecl Ty_uint256 (lit "#view47458") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCast (lit 256) (Expr_var (lit "_sol_hoist_0")))))),
(Stmt_varDecl Ty_uint256 (lit "#operand47459") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_binary BinaryOp_add (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#operand47452"))) (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#view47458")))))))),
(Stmt_returnValues (seq [(Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#operand47459")))]))]))]))]))
def collateralBody : Stmt := collateralPattern.value

def repPattern : Pattern Stmt :=
(Stmt_block (seq [(Stmt_skip),
(Stmt_block (seq [(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_ret_universeId_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret_universeId_0")]) (Stmt_internalCall (seq [(lit "_ret_universeId_0")]) (lit "__internal_universeId()#[]") (seq []))),
(Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "_ret_universeId_0")))])),
(Stmt_varDecl Ty_uint256 (lit "#view47475") (Option_some (Expr_castOp CastKind_uintCleanup (lit 248) (Expr_var (lit "_sol_hoist_0"))))),
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none),
oracleRepPattern,
(Stmt_varDecl Ty_uint256 (lit "#view47476") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "_sol_hoist_0"))))),
(Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none),
(Stmt_block (seq [(Stmt_varDecl Ty_uint256 (lit "_ic_arg_0") (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#view47476"))))),
(Stmt_varDecl Ty_uint256 (lit "_ic_arg_1") (Option_some (Expr_ternary (Expr_word (lit 1)) (Expr_word (lit 100)) (Expr_word (lit 100))))),
(Stmt_varDecl Ty_uint256 (lit "_ret___library_Math_ceilDiv_0") Option_none),
(Stmt_captureReturn (seq [(lit "_ret___library_Math_ceilDiv_0")]) (Stmt_internalCall (seq [(lit "_ret___library_Math_ceilDiv_0")]) (lit "__internal___library_Math_ceilDiv(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]") (seq [(Expr_var (lit "_ic_arg_0")),
(Expr_var (lit "_ic_arg_1"))]))),
(Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "_ret___library_Math_ceilDiv_0")))])),
(Stmt_returnValues (seq [(Expr_castOp CastKind_uintCleanup (lit 256) (Expr_castOp CastKind_uintCast (lit 256) (Expr_var (lit "_sol_hoist_0"))))]))]))]))]))
def repBody : Stmt := repPattern.value

end Inv48.Minima
