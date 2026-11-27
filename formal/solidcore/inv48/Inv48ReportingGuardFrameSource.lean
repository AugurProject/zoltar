import Inv48ReportingGuardFrameAssign
import Inv48EscrowTraceShape
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.ReportingGuardFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def immP (p : Pattern String) : Pattern Expr where
  value := .immutable p.value
  test | .immutable n => p.test n | _ => false
  sound v h := by
    split at h
    next n => simp only [p.sound n h]
    next => contradiction
def hoist := "_sol_hoist_0"
def ret := "_ret_universeId_0"
def universeP := Stmt_block (seq [
  Stmt_varDecl Ty_uint256 (lit ret) Option_none,
  Stmt_captureReturn (seq [lit ret]) (Stmt_internalCall (seq [lit ret])
    (lit "__internal_universeId()#[]") (seq [])),
  Stmt_assign (LValue_var (lit hoist)) (Expr_var (lit ret))])
def calldataP := Inv48.EscrowTrace.encPattern Inv48.EscrowTrace.plainSelector
  (Option_some (Expr_word (lit 3365542311))) (seq []) (seq [Ty_uint256])
  (seq [Expr_castOp CastKind_uintCast (lit 248) (Expr_var (lit "#view47899"))])
def reportingP := Inv48.EscrowTrace.callPattern (lit .staticcall) (immP (lit "securityPool"))
  calldataP (Expr_word (lit 0)) Option_none (lit false) (lit false)
  (seq [Inv48.EscrowTrace.bindingPattern (lit "__ext0") Ty_bool (lit false)])
  (seq [Inv48.EscrowTrace.noneCleanup])
  (Stmt_assign (LValue_var (lit hoist)) (Expr_var (lit "__ext0"))) (seq [])
def requireP := Stmt_requireStmt (Expr_var (lit "#view47900"))
  (Option_some (lit "Security pool reporting window closed"))
def bodyP := seq [
  Stmt_varDecl Ty_uint256 (lit hoist) Option_none,
  universeP,
  Stmt_varDecl Ty_uint256 (lit "#view47899")
    (Option_some (Expr_castOp CastKind_uintCleanup (lit 248) (Expr_var (lit hoist)))),
  Stmt_varDecl Ty_bool (lit hoist) Option_none,
  reportingP,
  Stmt_varDecl Ty_bool (lit "#view47900") (Option_some (Expr_var (lit hoist))),
  requireP]
def guardP := Stmt_block bodyP

theorem actualGuard : Inv48.GuardArgsFrame.guard 0 = guardP.value := by
  have h : Inv48.RequestQuote.actual[0]? = some guardP.value :=
    (Option_some guardP).sound _ (by native_decide)
  simp only [Inv48.GuardArgsFrame.guard,h,Option.getD_some]
end Inv48.ReportingGuardFrame
