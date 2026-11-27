import Inv48QuoteTransportCore
import Inv48RequestQuoteShape
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.QuoteTransport
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def quoteDeclP : Pattern Stmt where
  value := .memoryVarDecl Inv48.WholeQuote.quoteTy "quote" (some (.var hoist))
  test
    | .memoryVarDecl (.tuple [.uint256,.uint256,.uint256,.uint256,.uint256])
        "quote" (some (.var "_sol_hoist_0")) => true
    | _ => false
  sound v h := by split at h <;> simp_all [Inv48.WholeQuote.quoteTy,hoist]

def storageP (name : String) : Pattern LValue where
  value := .storage name
  test | .storage n => n == name | _ => false
  sound v h := by split at h <;> simp_all

def pendingP : Pattern (List Stmt) := seq [
  Stmt_assign (storageP "pendingExposureLimitAttoEth") (Inv48.QuoteMemory.cleanP (Inv48.RequestQuote.fieldP 3)),
  Stmt_assign (storageP "pendingReportMaxSettlementBaseFeeAttoEthPerGas") (Inv48.QuoteMemory.cleanP (Inv48.RequestQuote.fieldP 4)),
  Stmt_assign (storageP "pendingReportSponsor") (Expr_var (lit "sponsor"))]
def pending := pendingP.value

def suffixP := seq ([quoteDeclP] ++
  [Stmt_assign (storageP "pendingExposureLimitAttoEth") (Inv48.QuoteMemory.cleanP (Inv48.RequestQuote.fieldP 3)),
   Stmt_assign (storageP "pendingReportMaxSettlementBaseFeeAttoEthPerGas") (Inv48.QuoteMemory.cleanP (Inv48.RequestQuote.fieldP 4)),
   Stmt_assign (storageP "pendingReportSponsor") (Expr_var (lit "sponsor")),
   Stmt_varDecl Inv48.EscrowTrace.addressPattern (lit "escrow") Option_none])

theorem checkedSuffix : (Inv48.RequestQuote.actual.drop 7).take 5 = suffixP.value :=
  suffixP.sound _ (by native_decide)

def actualAlias : Option Stmt := do
  let .block ss ← Inv48.RequestQuote.actual[6]? | none
  ss[5]?
def aliasP := Stmt_assign (LValue_var (lit hoist)) (Expr_var (lit ret))
theorem checkedAlias : actualAlias = some aliasP.value :=
  (Option_some aliasP).sound _ (by native_decide)

def prepP := seq [Stmt_varDecl Ty_uint256 (lit "#result0") Option_none,
  Stmt_varDecl Inv48.EscrowTrace.addressPattern (lit "#result1") Option_none]
def actualPrep : List Stmt :=
  match Inv48.RequestQuote.actual[12]? with
  | some (Stmt.block ss) => ss.take 2
  | _ => []
theorem checkedPrep : actualPrep = prepP.value := prepP.sound _ (by native_decide)

end Inv48.QuoteTransport
