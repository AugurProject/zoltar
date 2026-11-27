import Inv08StoredQuote
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.ReleaseWrites
private def header (field : String) : Pattern Expr :=
  ⟨.storageRead .header field [], fun | .storageRead .header name [] => name==field | _ => false,
    by intro e h; dsimp only at h; split at h <;> simp_all⟩
private def duration : Pattern Expr :=
  ⟨.storageRead .ref "rewardDuration" [], fun | .storageRead .ref n [] => n=="rewardDuration" | _ => false,
    by intro e h; dsimp only at h; split at h <;> simp_all⟩
private def slot (field : String) : Pattern LValue :=
  ⟨.storage field, fun | .storage n => n==field | _ => false,
    by intro e h; dsimp only at h; split at h <;> simp_all⟩
def increment (name : String) := clean (clean (Expr_binary BinaryOp_mul (wvar name) (clean duration)))
def update (op : Pattern BinaryOp) (field : String) (rhs : Pattern Expr) :=
  Stmt_exprStmt (Expr_assignment (Option_some op) (Option_some (ValueCleanup_uint (lit 256))) (header field) rhs)
def record48 (field name : String) :=
  Stmt_assign (slot field) (Expr_castOp CastKind_uintCleanup (lit 48) (varP name))
def expected := seq [
  update BinaryOp_add "lastEthIntegralNumerator" (increment "ethAmount"),
  update BinaryOp_add "lastRepIntegralNumerator" (increment "repAmount"),
  update BinaryOp_sub "outstandingEth" (varP "ethAmount"),
  update BinaryOp_sub "outstandingRep" (varP "repAmount"),
  record48 "releasedThrough" "until", record48 "releasedExpiryId" "expiredId"]
def writes : Option (List Stmt) := do
  let f ← model.core.table.lookup? "__internal_release(uint48)#[SolidCore.Solidity.Ty.uint 48]"
  let .block [_,_,_,.block [.block [_,_,.captureReturn ["ethAmount","repAmount"] (.block body)]]] := f.body | none
  return body.drop 3
theorem fromGenerated : writes = some expected.value :=
  (Option_some expected).sound _ (by native_decide)
end Inv08.ReleaseWrites
