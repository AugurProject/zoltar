import Inv48RequestQuoteTrace
import Inv48EscrowTraceShape
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.RequestQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def requestKey := "__internal__requestPrice(address,uint256,uint256,uint256,uint32)#[SolidCore.Solidity.Ty.address false,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 32]"
def actual : List Stmt :=
  match Inv48.Source.model.core.table.lookup? requestKey with
  | some fn => match fn.body with
    | .block ss => match ss[6]? with
      | some (Stmt.block inner) => inner
      | _ => []
    | _ => []
  | none => []
def returns : List BindingDecl := [⟨"__ext0",.uint256,false⟩,⟨"__ext1",.address,false⟩]
def cleanups : List AbiCleanup := [.uint 256,.none]
def successBody : Stmt := .block [
  .assign (.var "#result0") (.castOp .uintCleanup 256 (.var "__ext0")),
  .assign (.var "#result1") (.var "__ext1")]
def callStmt : Stmt := .tryExternalCall .call .self (calldataExpr 2391489481) (.word 0)
  none false false returns cleanups successBody []
def fieldP (i : Nat) := Inv08.Integral.member "quote" i
def selfP : Pattern Expr where
  value := .self
  test | .self => true | _ => false
  sound v h := by cases v <;> simp_all

def callerP : Pattern Expr where
  value := .caller
  test | .caller => true | _ => false
  sound v h := by cases v <;> simp_all

def uintCleanupP (n : Nat) : Pattern AbiCleanup where
  value := .uint n
  test | .uint v => v == n | _ => false
  sound v h := by cases v <;> simp_all

def callP : Pattern Stmt := Inv48.EscrowTrace.callPattern (lit .call) selfP
  (Inv48.EscrowTrace.encPattern Inv48.EscrowTrace.plainSelector
    (Option_some (Expr_word (lit 2391489481))) (seq [])
    (seq [Inv48.EscrowTrace.addressPattern,Inv48.EscrowTrace.addressPattern,
      Ty_uint256,Ty_uint256,Ty_uint256,Ty_uint256,Ty_uint256])
    (seq [callerP,Expr_var (lit "sponsor"),fieldP 0,fieldP 1,fieldP 2,
      Expr_var (lit "bountyAttoEth"),Expr_var (lit "callbackGasLimit")]))
  (Expr_word (lit 0)) Option_none (lit false) (lit false)
  (seq [Inv48.EscrowTrace.bindingPattern (lit "__ext0") Ty_uint256 (lit false),
    Inv48.EscrowTrace.bindingPattern (lit "__ext1") Inv48.EscrowTrace.addressPattern (lit false)])
  (seq [uintCleanupP 256,Inv48.EscrowTrace.noneCleanup])
  (Stmt_block (seq [Stmt_assign (LValue_var (lit "#result0"))
    (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "__ext0"))),
    Stmt_assign (LValue_var (lit "#result1")) (Expr_var (lit "__ext1"))])) (seq [])

def actualCall : Option Stmt := do
  let .block ss ← actual[12]? | none
  ss[2]?

theorem checkedCall : actualCall = some callStmt :=
  (Option_some callP).sound _ (by native_decide)

def quoteKey := "__internal__quoteReportFunding(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"

def quoteCaptureP : Pattern Stmt := Stmt_captureReturn (seq [lit "_ret__quoteReportFunding_0"])
  (Stmt_internalCall (seq [lit "_ret__quoteReportFunding_0"]) (lit quoteKey)
    (seq [Expr_var (lit "_ic_arg_0"),Expr_var (lit "_ic_arg_1"),Expr_var (lit "_ic_arg_2")]))
def actualCapture : Option Stmt := do
  let Stmt.block ss ← actual[6]? | none
  ss[4]?
theorem checkedQuoteCapture : actualCapture = some quoteCaptureP.value :=
  (Option_some quoteCaptureP).sound _ (by native_decide)

#print axioms checkedQuoteCapture
#print axioms checkedCall
end Inv48.RequestQuote
