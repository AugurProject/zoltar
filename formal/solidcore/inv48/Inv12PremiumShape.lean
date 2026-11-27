import Inv12Calldata
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv12

def premiumArgs : List Expr := [.var "source", .var "child", .index (.var "branch") (.word 5), .index (.var "fork") (.word 1)]
def premiumData := encodeWordsExpr 2234981752 premiumArgs
def serviceAddress := Expr.var "#view55792"

private def dispatch : Pattern Stmt :=
  ⟨premiumCall serviceAddress premiumData, fun
   | .tryExternalCall .call (.var "#view55792") (.encode .withSelector (some (.word 2234981752)) []
       [.uint256,.uint256,.uint256,.uint256] [.var "source",.var "child",.index (.var "branch") (.word 5),.index (.var "fork") (.word 1)])
       (.word 0) none false true [] [] .skip [] => true
   | _ => false, by intro stmt h; dsimp only at h; split at h <;> simp_all <;> rfl⟩

def callbackStmt : Option Stmt := do
  let fn ← model.core.findFunctionByName? "choose"
  let .block [_,_,.block [.block [_,_,.captureReturn [] (.block body),_]]] := fn.body | none
  let .block [_,_,_,callback] ← (body.dropWhile (fun s => !missingGuard s))[4]? | none
  pure callback

theorem premiumFromChoose : callbackStmt=some (premiumCall serviceAddress premiumData) :=
  (Option_some dispatch).sound _ (by native_decide)
end Inv12
