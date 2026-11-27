import Inv12PremiumBlock
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv12

private def rootPat : Pattern Stmt :=
  ⟨rootGetter,fun
   | .tryExternalCall .staticcall (.immutable "securityPool") (.encode .withSelector (some (.word 2066428131)) [] [] [])
      (.word 0) none false false [⟨"__ext0",.address,false⟩] [.none] (.assign (.var "_sol_hoist_0") (.var "__ext0")) [] => true
   | _ => false,by intro s h;dsimp only at h;split at h <;> simp_all <;> rfl⟩

def serviceBlock : Option Stmt := do
  let fn ← model.core.findFunctionByName? "choose"
  let .block [_,_,.block [.block [_,_,.captureReturn [] (.block body),_]]] := fn.body | none
  (body.dropWhile (fun s => !missingGuard s))[4]?

private def dispatch : Pattern Stmt :=
  ⟨premiumCall serviceAddress premiumData, fun
   | .tryExternalCall .call (.var "#view55792") (.encode .withSelector (some (.word 2234981752)) []
       [.uint256,.uint256,.uint256,.uint256] [.var "source",.var "child",.index (.var "branch") (.word 5),.index (.var "fork") (.word 1)])
       (.word 0) none false true [] [] .skip [] => true
   | _ => false, by intro stmt h; dsimp only at h; split at h <;> simp_all <;> rfl⟩

def callbackPattern := Stmt_block (seq [Inv08.Authority.addressDecl Inv03.Bodies.tmp Option_none,rootPat,
  Inv08.Authority.addressDecl viewName (Option_some (Inv03.Bodies.varP Inv03.Bodies.tmp)),dispatch])

theorem serviceBlockChecked : serviceBlock=some (.block callbackCode) :=
  (Option_some callbackPattern).sound _ (by native_decide)
end Inv12
