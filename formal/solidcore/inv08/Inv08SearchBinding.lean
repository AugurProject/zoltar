import Inv08Model
import Inv03Bodies
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.Expiry
def key := "__internal__expired(uint48)#[SolidCore.Solidity.Ty.uint 48]"
def clean48 := Expr_castOp CastKind_uintCleanup (lit 48)
def uint48 := Expr_castOp CastKind_uintCast (lit 48)
def twice (e : Pattern Expr) := clean48 (clean48 e)
def w48 (name : String) := clean48 (varP name)
def midpoint := twice (Expr_binary BinaryOp_add (w48 "low")
  (twice (Expr_binary BinaryOp_div
    (twice (Expr_binary BinaryOp_add (twice (Expr_binary BinaryOp_sub (w48 "high") (w48 "low"))) (uint48 (num 1))))
    (uint48 (num 2)))))
def loopMidpoint : Option Expr := do
  let funDef ← model.core.table.lookup? key
  let .block [_,_,.block stmts] := funDef.body | none
  let some (.whileLoop _ (.block (.varDecl .uint256 "middle" (some expr) :: _))) := stmts[stmts.length-2]? | none
  return expr
theorem boundToSolidity : loopMidpoint = some midpoint.value :=
  (Option_some midpoint).sound _ (by native_decide)
end Inv08.Expiry
