import Inv08AddStreamState
import Inv08FundingRecord
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.AddStream
def rawKey := "__internal__addStream(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def budgetKey := "__internal__requireBudget()#[]"
def timeExpr : Pattern Expr := ⟨.env .blockTimestamp,fun | .env .blockTimestamp=>true | _=>false,
  by intro x h; dsimp only at h; split at h <;> simp_all⟩
def fieldWord (k : Field) := clean (Expiry.refField k.name)
def field48 (k : Field) := Expiry.clean48 (Expiry.refField k.name)
def constant (k : Nat) := clean (Authority.convert 256 (num k))
def maximum (bits : Nat) := Expr_ternary (num 1) (constant (2^bits-1)) (constant (2^bits-1))
def sum (a b : Pattern Expr) := Authority.dclean (Expr_binary BinaryOp_add a b)
def timeGuard := Authority.guard (Expr_binary BinaryOp_eq (fieldWord .through) (clean timeExpr)) "Checkpoint fees before funding"
def endGuard := Authority.guard (Expr_binary BinaryOp_le (sum (clean (Authority.convert 256 (Expiry.refField "releasedThrough")))
  (fieldWord .duration)) (maximum 48)) "Invalid fee duration"
def nonzero (s : String) := Expr_binary Authority.neOp (wvar s) (num 0)
def amountGuard := Authority.guard (Expr_binary BinaryOp_boolOr (nonzero "ethAmount") (nonzero "repAmount")) "Empty fee stream"
def outstanding (eth : Bool) := ReleaseWrites.update BinaryOp_add (outstandingField eth).name (varP (amountLocal eth))
def deferredName (eth : Bool) := if eth then "deferredEth" else "deferredRep"
def budgetTest (eth : Bool) := Expr_binary BinaryOp_le (sum (fieldWord (outstandingField eth)) (clean (Expiry.refField (deferredName eth)))) (maximum 128)
def budgetBody := block [block [Authority.guard (Authority.both (budgetTest true) (budgetTest false)) "Fee budget exceeds token domain"]]
def callVoid (key : String) (args : List (Pattern Expr)) := Stmt_captureReturn (seq []) (Stmt_internalCall (seq []) (lit key) (seq args))
def budget := block [callVoid budgetKey []]
def rate (eth : Bool) := Expiry.typed (FundingRecord.amountName eth) (wvar (amountLocal eth))
def ending := Expiry.typed "end" (Expiry.twice (Expr_binary BinaryOp_add (field48 .through) (field48 .duration)))
def tupleTy := Ty.tuple [.uint256,.uint256,.uint256,.uint256,.uint256]
def previous : Pattern Stmt where
  value := .memoryVarDecl tupleTy "previous" (some (.storageRead .element "expiries" [(field48 .latest).value]))
  test | .memoryVarDecl (.tuple [.uint256,.uint256,.uint256,.uint256,.uint256]) "previous" (some (.storageRead .element "expiries" [i])) =>
          (field48 .latest).test i
       | _ => false
  sound v h := by
    split at h
    next i => rw [(field48 .latest).sound _ h]; rfl
    next => contradiction
def increment : Pattern Stmt where
  value := .exprStmt (.incDec .add false (some (.uint 48)) (.storageRead .header "lastExpiryId" []))
  test | .exprStmt (.incDec .add false (some (.uint 48)) (.storageRead .header "lastExpiryId" [])) => true | _=>false
  sound v h := by split at h <;> simp_all
def different := Expr_binary Authority.neOp (Expiry.clean48 (Integral.member "previous" 0)) (Expiry.w48 "end")
def appendId := Stmt_ifElse different increment Stmt_skip
def store : Pattern Stmt where
  value := .assign (.storageIndex "expiries" (field48 .latest).value) (.tuple FundingRecord.expected.value)
  test | .assign (.storageIndex "expiries" i) (.tuple items) => (field48 .latest).test i && FundingRecord.expected.test items
       | _ => false
  sound v h := by
    split at h
    next i items =>
      simp only [Bool.and_eq_true] at h
      rw [(field48 .latest).sound _ h.1,FundingRecord.expected.sound _ h.2]
    next => contradiction
def scale (eth : Bool) := Authority.dclean (Expr_binary BinaryOp_mul (wvar (FundingRecord.amountName eth)) (fieldWord .through))
def cursor (eth : Bool) := ReleaseWrites.update BinaryOp_add (cursorField eth).name (scale eth)
def actions := [timeGuard,endGuard,amountGuard,outstanding true,outstanding false,budget,rate true,rate false,
  ending,previous,appendId,store,cursor true,cursor false]
def body := block [param "ethAmount",param "repAmount",block actions]
def forwardCall := block [Expiry.typed "_ic_arg_0" (wvar "ethAmount"),Expiry.typed "_ic_arg_1" (wvar "repAmount"),
  callVoid rawKey [varP "_ic_arg_0",varP "_ic_arg_1"]]
def publicBody := block [param "ethAmount",param "repAmount",block [block [
  Authority.callerGuard,Authority.initializedGuard,Stmt_captureReturn (seq []) (block [forwardCall])]]]
theorem rawLink : Inv32Library.LinkAt model.core.table rawKey [.word "ethAmount",.word "repAmount"] [] body.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some body).sound _ (by native_decide))
theorem budgetLink : Inv32Library.LinkAt model.core.table budgetKey [] [] budgetBody.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some budgetBody).sound _ (by native_decide))
end Inv08.AddStream
