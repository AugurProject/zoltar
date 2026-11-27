import Inv48BountyGuardFrameCopy
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BountyGuardFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def capture : Stmt := .captureReturn [ret] (.internalCall [ret] key [.var "_ic_arg_0"])
def copy : Stmt := .assign (.var hoist) (.var ret)
def argExpr : Expr := .castOp .uintCleanup 256 (.var "callbackGasLimit")
def viewExpr : Expr := .castOp .uintCleanup 256 (.var hoist)
def condition : Expr := .binary .ge (.castOp .uintCleanup 256 (.var "bountyAttoEth"))
  (.castOp .uintCleanup 256 (.var "#view47925"))
def inner : List Stmt := [.varDecl .uint256 "_ic_arg_0" (some argExpr),
  .varDecl .uint256 ret none,capture,copy]
def body : List Stmt := [.varDecl .uint256 hoist none,.block inner,
  .varDecl .uint256 "#view47925" (some viewExpr),.requireStmt condition (some "Oracle bounty too small")]

open Inv32Shapes

def argP := Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "callbackGasLimit"))
def viewP := Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit hoist))
def condP := Expr_binary geP
  (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "bountyAttoEth")))
  (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "#view47925")))
def pattern := Stmt_block (seq [
  Stmt_varDecl Ty_uint256 (lit hoist) Option_none,
  Stmt_block (seq [Stmt_varDecl Ty_uint256 (lit "_ic_arg_0") (Option_some argP),
    Stmt_varDecl Ty_uint256 (lit ret) Option_none,
    Stmt_captureReturn (seq [lit ret])
      (Stmt_internalCall (seq [lit ret]) (lit key) (seq [Expr_var (lit "_ic_arg_0")])),
    Stmt_assign (LValue_var (lit hoist)) (Expr_var (lit ret))]),
  Stmt_varDecl Ty_uint256 (lit "#view47925") (Option_some viewP),
  Stmt_requireStmt condP (Option_some (lit "Oracle bounty too small"))])
theorem checked : pattern.test (guard 3) = true := by native_decide
theorem actual : guard 3 = .block body := pattern.sound _ checked

end Inv48.BountyGuardFrame
