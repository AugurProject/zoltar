import Inv39Sites
import Inv03Bodies
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv39.ERC20
def balanceAt (arg : String) : Pattern Expr :=
  ⟨.storageRead .element "_balances" [.var arg],
    fun | .storageRead .element "_balances" [.var a] => a==arg | _ => false,
    by intro x h; dsimp only at h; split at h <;> simp_all⟩
def targetAt (arg : String) : Pattern LValue :=
  ⟨.storageIndex "_balances" (.var arg),fun | .storageIndex "_balances" (.var a) => a==arg | _ => false,
    by intro x h; dsimp only at h; split at h <;> simp_all⟩
def reject : Pattern Stmt := ⟨.revertError (some "ERC20 transfer amount exceeds sender balance"),
  fun | .revertError (some "ERC20 transfer amount exceeds sender balance") => true | _ => false,
  by intro x h; dsimp only at h; split at h <;> simp_all⟩
def transferEvent : Pattern Stmt := ⟨.emitEvent "Transfer" [.var "from",.var "to",.var "value"],
  fun | .emitEvent "Transfer" [.var "from",.var "to",.var "value"] => true | _ => false,
  by intro x h; dsimp only at h; split at h <;> simp_all⟩
def cond (arg : String) := Expr_binary BinaryOp_eq (varP arg) (num 0)
def subBalance := clean (clean (Expr_binary BinaryOp_sub (wvar "fromBalance") (wvar "value")))
def insufficient := Expr_binary BinaryOp_lt (wvar "fromBalance") (wvar "value")
def debit := block [decl "fromBalance" (Option_some (clean (balanceAt "from"))),
  Stmt_ifElse insufficient (block [reject]) Stmt_skip,
  Stmt_unchecked (block [Stmt_assign (targetAt "from") subBalance])]
def creditExpr := Expr_assignment (Option_some BinaryOp_add) (Option_some (ValueCleanup_uint (lit 256)))
  (balanceAt "to") (varP "value")
def credit := block [Stmt_unchecked (block [Stmt_exprStmt creditExpr])]
def mint := block [Stmt_exprStmt (supplyOp BinaryOp_add "_totalSupply" "value")]
def burn := block [Stmt_unchecked (block [Stmt_exprStmt (supplyOp BinaryOp_sub "_totalSupply" "value")])]
def fromStep := Stmt_ifElse (cond "from") mint debit
def toStep := Stmt_ifElse (cond "to") burn credit
def body := block [Stmt_skip,Stmt_skip,param "value",block [fromStep,toStep,transferEvent]]
def metadata? (f : InternalFunction) : Bool :=
  match f.params, f.returns with
  | [⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩], [] => true
  | _, _ => false
private theorem linkOfCheck (o : Option InternalFunction)
    (both : (o.map fun f => metadata? f && body.test f.body) = some true) :
    ∃ f, o = some f ∧
    f.params = [⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩] ∧
    f.returns = [] ∧ f.body = body.value := by
  cases o with
  | none => contradiction
  | some f =>
    simp only [Option.map_some,Option.some.injEq,Bool.and_eq_true] at both
    obtain ⟨metaOk,b⟩ := both
    refine ⟨f,rfl,?_,?_,body.sound _ b⟩ <;> unfold metadata? at metaOk <;> split at metaOk <;> simp_all
theorem linked : ∃ f, model.core.table.lookup? updateKey = some f ∧
    f.params = [⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩] ∧
    f.returns = [] ∧ f.body = body.value := linkOfCheck _ (by native_decide)
end Inv39.ERC20
