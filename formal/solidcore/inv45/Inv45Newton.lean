import Inv45DivideTwos
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.MulDiv
abbrev merge := compound "prod0" BinaryOp_bitOr (mul (v "prod1") (v "twos"))
abbrev finish := assign "result" (mul (v "prod0") (v "inverse"))
def tail := merge.value :: (decl "inverse" (Option_some seed)).value :: (List.replicate 6 step.value ++ [finish.value])
theorem newtonRun (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y rem : Nat)
    (d hi lo tw : W) (un : c.checked=false) :
    let merged := lo ||| hi*tw
    let i := Inv32Newton.iterate d 6
    let after := withFactor r x y d.toNat (merged*i).toNat hi.toNat merged.toNat rem tw.toNat
    Stmt.evalList (n+1) t c (withFactor r x y d.toNat 0 hi.toNat lo.toNat rem tw.toNat) tail =
      pure (.normal (Inv32NewtonBody.put after i)) := by
  let m := lo ||| hi*tw
  let i := Inv32Newton.iterate d 6
  let src := withFactor r x y d.toNat 0 hi.toNat lo.toNat rem tw.toNat
  let merged := withFactor r x y d.toNat 0 hi.toNat m.toNat rem tw.toNat
  let after := withFactor r x y d.toNat (m*i).toNat hi.toNat m.toNat rem tw.toNat
  have M : Stmt.eval (n+1) t c src merge.value = pure (.normal merged) := by
    apply Inv32Compound.stmt n t .bitOr c src merged "prod0" lo.toNat (hi*tw).toNat m.toNat
      (Inv32NewtonBody.twice (Inv32Product.mulF (Inv32Product.clean (Inv32Scalar.localWord "prod1")) (Inv32Product.clean (Inv32Scalar.localWord "twos")))) (by decide) rfl
    · rw [un];exact Inv32WideFinish.product _ "prod1" "twos" hi tw rfl rfl
    · rw [un];exact Inv32WideWords.orWord _ _
    · exact m.isLt
    · dsimp [src,merged];store_div
  have zero : (decl "inverse" (Option_some seed)).value=Inv32NewtonSeed.declaration := rfl
  have seedExec := Inv32NewtonSeed.declarationExec n t c merged d un rfl
  have it := Inv32NewtonBody.iterateSteps 6 n t c merged d [finish.value] un rfl
  let inv := Inv32NewtonBody.put merged i
  let dst := Inv32NewtonBody.put after i
  have F := Inv32WideFinish.product (Inv32Actions.locals inv) "prod0" "inverse" m i rfl rfl
  have P : (mul (v "prod0") (v "inverse")).value.eval c inv = pure (.word (m*i).toNat,inv) :=
    Inv32Actions.evalFormula (Inv32NewtonBody.twice (Inv32Product.mulF (Inv32Product.clean (Inv32Scalar.localWord "prod0")) (Inv32Product.clean (Inv32Scalar.localWord "inverse")))) c inv _ (by decide) (un ▸ F)
  have last : Stmt.eval (n+1) t c inv finish.value = pure (.normal dst) := by
    apply Inv32Assign.scalarCast n t c inv dst "result" 0 _ .uintCleanup 256 _ rfl P
    dsimp [inv,dst,after,merged,Inv32NewtonBody.put,Runtime.declareLocal,LocalEnv.declare]
    store_div
  change Stmt.evalList (n+1) t c src tail=pure (.normal dst)
  unfold tail
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ M,zero,Inv32FloorStart.seqStep _ _ _ _ _ _ _ seedExec,sameNewton,it]
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ last,Stmt.evalList]
end Inv45.MulDiv
