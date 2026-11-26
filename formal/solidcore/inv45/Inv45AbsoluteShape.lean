import Inv45Model
import Inv03Bodies
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv45.Shapes
def signedCast (e : Pattern Source.Expr) := Expr_castOp (⟨.intCleanup,(fun | .intCleanup=>true | _=>false),by intro v h;cases v <;> simp_all⟩) (lit 256) e
def signedLiteral (v : Nat) : Pattern Source.Expr where
  value := .intWord v
  test | .intWord i => i == v | _ => false
  sound e h := by split at h <;> simp_all
def negative (e : Pattern Source.Expr) := Expr_unary (⟨.neg,(fun | .neg=>true | _=>false),by intro v h;cases v <;> simp_all⟩) e
def ge (x y : Pattern Source.Expr) := Expr_binary (⟨.ge,(fun | .ge=>true | _=>false),by intro v h;cases v <;> simp_all⟩) x y
abbrev value := varP "value"
def nonnegative := ge (signedCast value) (signedLiteral 0)
def positive := clean (Expr_castOp CastKind_uintCast (lit 256) value)
def mag :=
  let plusOne := Expr_binary BinaryOp_add value (signedLiteral 1)
  let negated := signedCast (signedCast (signedCast (negative plusOne)))
  clean (clean (Expr_binary BinaryOp_add (clean (clean negated)) (num 1)))
def absoluteBody := block [assign "value" (signedCast value), Stmt_skip,block
  [Stmt_ifElse nonnegative (ret positive) Stmt_skip,Stmt_unchecked (block [ret mag])]]
abbrev absoluteKey := "__internal___library_ScalarOutcomes_absoluteInt256(int256)#[SolidCore.Solidity.Ty.int 256]"
def absoluteFn? := model.core.table.lookup? absoluteKey
theorem existsFn : absoluteFn?.isSome := by native_decide
def absoluteFn := absoluteFn?.get existsFn
theorem absoluteSource : absoluteFn.body=absoluteBody.value :=
  absoluteBody.sound _ (by native_decide)
private def sig : List BindingDecl → List BindingDecl → Bool
  | [⟨"value",.int256,false⟩],[⟨"_ret0",.uint256,false⟩] => true
  | _,_ => false
theorem absoluteSignature : absoluteFn.params=[⟨"value",.int256,false⟩] ∧ absoluteFn.returns=[⟨"_ret0",.uint256,false⟩] := by
  have h : sig absoluteFn.params absoluteFn.returns := by native_decide
  generalize absoluteFn.params=ps at *
  generalize absoluteFn.returns=rs at *
  unfold sig at h;split at h <;> simp_all
end Inv45.Shapes
