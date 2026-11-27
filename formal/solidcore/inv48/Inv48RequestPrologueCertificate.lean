import Inv48RequestPrologueShape
import Inv48RequestProloguePrefix
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def memoryDeclP (name : String) : Pattern Stmt where
  value := .memoryVarDecl Inv48.WholeQuote.quoteTy name none
  test | .memoryVarDecl (.tuple [.uint256,.uint256,.uint256,.uint256,.uint256]) n none => n == name | _ => false
  sound v h := by split at h <;> simp_all [Inv48.WholeQuote.quoteTy]
def tempP (name source : String) := Stmt_varDecl Ty_uint256 (lit name)
  (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit source))))
def quotePrefixP := seq [tempP "_ic_arg_0" "proposedRepPerEthPrice",
  tempP "_ic_arg_1" "requestedInitialAttoWeth",tempP "_ic_arg_2" "bountyAttoEth",
  memoryDeclP Inv48.QuoteTransport.ret]
def quoteBlockP := Stmt_block (seq [tempP "_ic_arg_0" "proposedRepPerEthPrice",
  tempP "_ic_arg_1" "requestedInitialAttoWeth",tempP "_ic_arg_2" "bountyAttoEth",
  memoryDeclP Inv48.QuoteTransport.ret,Inv48.RequestQuote.quoteCaptureP,Inv48.QuoteTransport.aliasP])
def publicRequest := Inv48.Source.model.core.findFunctionByName? "requestSecurityPoolPrice"
def publicReturnP := seq [Inv48.EscrowTrace.bindingPattern (lit "reportId") Ty_uint256 (lit false)]
def cleanupP (bits : Nat) (name : String) := Stmt_assign (LValue_var (lit name))
  (Expr_castOp CastKind_uintCleanup (lit bits) (Expr_var (lit name)))
def publicPrologueP := seq [cleanupP 256 "proposedRepPerEthPrice",
  cleanupP 256 "requestedInitialAttoWeth",cleanupP 256 "bountyAttoEth",Stmt_skip]
def outer (stmt : Stmt) : List Stmt := match stmt with | .block ss => ss | _ => []
def sourceCheck : Bool :=
  ((Inv48.RequestQuote.actual[5]?).map (memoryDeclP Inv48.QuoteTransport.hoist).test == some true) &&
  ((Inv48.RequestQuote.actual[6]?).map quoteBlockP.test == some true) &&
  ((publicRequest.map fun fn => quoteParamP.test fn.params && publicReturnP.test fn.returns && fn.payable && publicPrologueP.test ((outer fn.body).take 4)) == some true)

theorem checkedSource : sourceCheck = true := by native_decide

end Inv48.RequestPrologue
