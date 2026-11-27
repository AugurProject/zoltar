import Inv02Getter
import Inv02IndexMath

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes
namespace Inv02

private def bodyShape : Pattern Source.Stmt := Id.run do
  let v := fun n => Expr_var (lit n)
  let num := fun n => Expr_word (lit n)
  let clean := fun e => Expr_castOp CastKind_uintCleanup (lit 256) e
  let castTmp := clean (Expr_castOp CastKind_uintCast (lit 256) (v Getter.tmp))
  let block := fun (xs : List (Pattern Source.Stmt)) => Stmt_block (seq xs)
  let decl := fun n => Stmt_varDecl Ty_uint256 (lit n)
  let assign := fun n => Stmt_assign (LValue_var (lit n))
  let ret := fun e => Stmt_returnValues (seq [e])
  let param := fun n => assign n (clean (v n))
  let hoist := fun x factor d =>
    let slot := Inv32FloorHoist.ret
    let args := [Inv32FloorHoist.a0,Inv32FloorHoist.a1,Inv32FloorHoist.a2]
    let dest := seq [lit slot]
    block [decl Inv32FloorHoist.a0 (Option_some (clean (v x))),
      decl Inv32FloorHoist.a1 (Option_some (Expr_ternary (num 1) (num factor) (num factor))),
      decl Inv32FloorHoist.a2 (Option_some (clean (v d))),decl slot Option_none,
      Stmt_captureReturn dest (Stmt_internalCall dest (lit Inv32Bodies.Floor.key) (seq (args.map v))),
      assign Getter.tmp (v slot)]
  return block [param "rep",param "commitment",param "multiplier",Stmt_skip,block [
    Stmt_ifElse (Expr_binary BinaryOp_eq (clean (v "commitment")) (num 0))
      (ret (clean (num (2^256-1)))) Stmt_skip,
    block [decl Getter.tmp Option_none,hoist "rep" 10000 "multiplier",
      decl Getter.baseName (Option_some castTmp),decl Getter.tmp Option_none,
      hoist Getter.baseName (10^18) "commitment",ret castTmp]]]

def selection := indexModel.core.findFunctionByName? "maximumHealthyPrice"
private theorem present : selection.isSome := by native_decide
def getter := selection.get present
private theorem bodyChecks : bodyShape.test getter.body = true := by native_decide
theorem getterBody : getter.body = Getter.body := (bodyShape.sound _ bodyChecks).trans rfl

theorem getterParams : getter.params = Inv32Internal.wordBindings ["rep","commitment","multiplier"] :=
  Inv32Internal.wordBindingsOf _ _ (by native_decide)
theorem getterReturns : getter.returns = Inv32Internal.wordBindings ["_ret0"] :=
  Inv32Internal.wordBindingsOf _ _ (by native_decide)
end Inv02
