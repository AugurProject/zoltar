import Inv48SimpleWrapperArgsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.SimpleWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def noneDeclP (ty : Pattern Ty) (name : String) := Stmt_varDecl ty (lit name) Option_none
def declP (ty : Pattern Ty) (name : String) (expr : Pattern Expr) :=
  Stmt_varDecl ty (lit name) (Option_some expr)
def castP (bits : Nat) (name : String) := Expr_castOp CastKind_uintCleanup (lit bits) (Expr_var (lit name))
def getterBlockP := Stmt_block (seq [noneDeclP Ty_uint256 ret,
  Stmt_captureReturn (lit [ret]) (Stmt_internalCall (lit [ret]) (lit getterKey) List_nil),
  Stmt_assign (LValue_var (lit hoist)) (Expr_var (lit ret))])
def requestPrefixP := seq [declP Inv48.EscrowTrace.addressPattern "_ic_arg_0" Inv48.RequestQuote.callerP,
  declP Ty_uint256 "_ic_arg_1" (castP 256 "proposedRepPerEthPrice"),
  declP Ty_uint256 "_ic_arg_2" (castP 256 "requestedInitialAttoWeth"),
  declP Ty_uint256 "_ic_arg_3" (castP 256 "bountyAttoEth"),
  declP Ty_uint256 "_ic_arg_4" (castP 32 viewName),
  noneDeclP Ty_uint256 "_ret__requestPrice_0"]
def beforeRequestP := seq [noneDeclP Ty_uint256 hoist,getterBlockP,
  declP Ty_uint256 viewName (castP 32 hoist),noneDeclP Ty_uint256 hoist]
def callP := Stmt_internalCall (lit ["_ret__requestPrice_0"])
  (lit Inv48.RequestQuote.requestKey) Inv48.WrapperArgs.callArgsP
def refundKey := "__internal__refundExcessBounty(uint256)#[SolidCore.Solidity.Ty.uint 256]"
def bodyP := Stmt_block (seq [
  Inv48.RequestPrologue.cleanupP 256 "proposedRepPerEthPrice",
  Inv48.RequestPrologue.cleanupP 256 "requestedInitialAttoWeth",
  Inv48.RequestPrologue.cleanupP 256 "bountyAttoEth",Stmt_skip,
  Stmt_block (seq [Stmt_block (seq [noneDeclP Ty_uint256 hoist,getterBlockP,
    declP Ty_uint256 viewName (castP 32 hoist),noneDeclP Ty_uint256 hoist,
    Stmt_block (seq [declP Inv48.EscrowTrace.addressPattern "_ic_arg_0" Inv48.RequestQuote.callerP,
      declP Ty_uint256 "_ic_arg_1" (castP 256 "proposedRepPerEthPrice"),
      declP Ty_uint256 "_ic_arg_2" (castP 256 "requestedInitialAttoWeth"),
      declP Ty_uint256 "_ic_arg_3" (castP 256 "bountyAttoEth"),
      declP Ty_uint256 "_ic_arg_4" (castP 32 viewName),noneDeclP Ty_uint256 "_ret__requestPrice_0",
      Stmt_captureReturn (lit ["_ret__requestPrice_0"]) callP,
      Stmt_assign (LValue_var (lit hoist)) (Expr_var (lit "_ret__requestPrice_0"))]),
    Stmt_assign (LValue_var (lit "reportId")) (castP 256 hoist)]),
    Stmt_block (seq [declP Ty_uint256 "_ic_arg_0" (castP 256 "bountyAttoEth"),
      Stmt_captureReturn (lit []) (Stmt_internalCall (lit []) (lit refundKey)
        (seq [Expr_var (lit "_ic_arg_0")]))])])])
def uintCleanupP : Pattern AbiCleanup where
  value := .uint 256
  test | .uint n => n == 256 | _ => false
  sound v h := by split at h <;> simp_all

def abiCleanupsP := seq [uintCleanupP,uintCleanupP,uintCleanupP]
def sourceCheck : Bool := Inv48.RequestPrologue.publicRequest.any fun fn =>
  bodyP.test fn.body && abiCleanupsP.test fn.paramAbiCleanups
theorem checkedSource : sourceCheck = true := by native_decide

theorem wrapperBody (fn : FunctionDef) (found : Inv48.RequestPrologue.publicRequest = some fn) :
    fn.body = bodyP.value := by
  have h := checkedSource
  simp only [sourceCheck,found,Option.any_some,Bool.and_eq_true] at h
  exact bodyP.sound _ h.1

theorem wrapperCleanups (fn : FunctionDef) (found : Inv48.RequestPrologue.publicRequest = some fn) :
    fn.paramAbiCleanups = [.uint 256,.uint 256,.uint 256] := by
  have h := checkedSource
  simp only [sourceCheck,found,Option.any_some,Bool.and_eq_true] at h
  exact abiCleanupsP.sound _ h.2
end Inv48.SimpleWrapperArgs
