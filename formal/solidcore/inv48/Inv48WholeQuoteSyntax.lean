import Inv48WholeQuoteEntry
import Inv48QuoteMemoryShape
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
open QuoteMemory

def zeroP := Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none
def declP (s : String) (e : Pattern Expr) := Stmt_varDecl Ty_uint256 (lit s) (Option_some e)
def copyP (s : String) (e : Pattern Expr) := Stmt_assign (LValue_var (lit s)) e

def callP (ret key : String) (args : List (Pattern Expr)) :=
  Stmt_captureReturn (lit [ret]) (Stmt_internalCall (lit [ret]) (lit key) (seq args))
def hoistP (ret key : String) (args : List (Pattern Expr)) := Stmt_block (seq
  ((args.zipIdx.map fun (e,i) => declP ("_ic_arg_"++toString i) e) ++
    [Stmt_varDecl Ty_uint256 (lit ret) Option_none,
     callP ret key (args.zipIdx.map fun (_,i) => varP ("_ic_arg_"++toString i)),
     copyP "_sol_hoist_0" (varP ret)]))
def bpsP := Expr_ternary (wordP 1) (wordP 10000) (wordP 10000)
def hundredP := Expr_ternary (wordP 1) (wordP 100) (wordP 100)
def haltArgsP := [cleanP (fieldP 0),cleanP (immutableP "escalationHaltMultiplierBps"),bpsP]
def envP : Pattern Expr where
  value := .env .blockBasefee
  test | .env .blockBasefee => true | _ => false
  sound v h := by cases v <;> simp_all; split at h <;> simp_all

def feeArgsP := [cleanP (cleanP (Expr_binary BinaryOp_add (cleanP envP)
  (cleanP (immutableP "initialReportPriorityFeeAttoEthPerGas")))),
  cleanP (immutableP "maxSettlementBaseFeeMultiplierBps"),bpsP]
def floorP (args : List (Pattern Expr)) :=
  hoistP "_ret___library_Math_mulDiv_0" Inv32Bodies.Floor.key args

def minPrefixP := [zeroP,
  hoistP "_ret_minimumToken1ReportAttoEthForPrice_0"
    "__internal_minimumToken1ReportAttoEthForPrice(uint256)#[SolidCore.Solidity.Ty.uint 256]"
    [cleanP (varP "proposedRepPerEthPrice")],
  declP "#view48027" (cleanP (varP "_sol_hoist_0"))]
def geP : Pattern BinaryOp where
  value := .ge
  test | .ge => true | _ => false
  sound v h := by split at h <;> simp_all
def minGuardP := Stmt_requireStmt
  (Expr_binary geP (cleanP (varP "requestedInitialAttoWeth")) (cleanP (varP "#view48027")))
  (lit (some "Report funding below minimum"))
def minP := Stmt_block (seq (minPrefixP++[minGuardP]))
def oracleP := [zeroP,
  hoistP "_ret_aggregateExposureAttoEth_0" "__internal_aggregateExposureAttoEth()#[]" [],
  declP "#view48072" (cleanP (varP "_sol_hoist_0")),zeroP,
  hoistP "_ret___library_Math_ceilDiv_0"
    "__internal___library_Math_ceilDiv(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
    [cleanP (varP "#view48072"),hundredP],
  declP "exposureEscalationHaltAttoEth" (cleanP QuoteMemory.hoistP)]
def maximumP := Stmt_ifElse
  (Expr_binary BinaryOp_gt (cleanP (varP "exposureEscalationHaltAttoEth")) (cleanP (fieldP 2)))
  (writeP 2 (varP "exposureEscalationHaltAttoEth")) Stmt_skip

def upperP (i : Nat) (message : String) := Stmt_requireStmt
  (Expr_binary BinaryOp_le (cleanP (fieldP i)) (cleanP (wordP (2^128-1)))) (lit (some message))
def guardsP := [upperP 0 "WETH report exceeds uint128",upperP 1 "REP report exceeds uint128",
  upperP 2 "Oracle escalation halt amount exceeds uint128 maximum",
  Stmt_requireStmt (Expr_binary BinaryOp_le (cleanP (varP "bountyAttoEth")) (cleanP (wordP (2^96-1))))
    (lit (some "Oracle settler reward exceeds uint96 maximum"))]
def interiorP := seq ([minP,writeP 0 (varP "requestedInitialAttoWeth"),zeroP,ceilPattern,
  writeP 1 QuoteMemory.hoistP,zeroP,floorP haltArgsP,writeP 2 QuoteMemory.hoistP] ++
  oracleP ++ [maximumP] ++ guardsP ++ [exposureP,zeroP,floorP feeArgsP,writeP 4 QuoteMemory.hoistP])
def localizeP : Pattern Stmt where
  value := .memoryLocalize quoteTy "quote"
  test | .memoryLocalize (.tuple [.uint256,.uint256,.uint256,.uint256,.uint256]) name => name=="quote" | _ => false
  sound v h := by split at h <;> simp_all [quoteTy]

def bodyP := Stmt_block (seq [copyP "proposedRepPerEthPrice" (cleanP (varP "proposedRepPerEthPrice")),
  copyP "requestedInitialAttoWeth" (cleanP (varP "requestedInitialAttoWeth")),
  copyP "bountyAttoEth" (cleanP (varP "bountyAttoEth")),localizeP,Stmt_block interiorP])
end Inv48.WholeQuote
