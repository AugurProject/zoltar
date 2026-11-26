import Inv39SupplyWrites
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv39
def updateKey := "__internal__update(address,address,uint256)#[SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.uint 256]"
def burnKey := "__internal_burn(address,uint256)#[SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.uint 256]"
def supplySites : Option (List Expr) := do
  let upd ← model.core.table.lookup? updateKey
  let .block [_,_,_,.block [
    .ifElse (.binary .eq (.var "from") (.word 0)) (.block [.exprStmt mint]) _,
    .ifElse (.binary .eq (.var "to") (.word 0)) (.block [.unchecked (.block [.exprStmt burn])]) _,
    .emitEvent "Transfer" [.var "from",.var "to",.var "value"]]] := upd.body | none
  let entry ← model.core.table.lookup? burnKey
  let .block [_,_,.block [.block [_,.captureReturn [] (.block [_,.exprStmt cost,.emitEvent "Burn" _])]]] := entry.body | none
  return [mint,burn,cost]
def header (name : String) : Pattern Expr :=
  ⟨.storage name,fun | .storageRead .header n [] => n == name | _ => false,
    by intro x h; dsimp only at h; split at h <;> simp_all [Expr.storage]⟩
def supplyOp (op : Pattern BinaryOp) (field varName : String) := Expr_assignment (Option_some op)
  (Option_some (ValueCleanup_uint (lit 256))) (header field) (Expr_var (lit varName))
def expected := seq [supplyOp BinaryOp_add circulating.name "value",supplyOp BinaryOp_sub circulating.name "value",
  supplyOp BinaryOp_sub theoretical.name "valueAttoRep"]
theorem linked : supplySites = some [updateExpr circulating .add "value", updateExpr circulating .sub "value",
    updateExpr theoretical .sub "valueAttoRep"] := (Option_some expected).sound _ (by native_decide)
end Inv39
