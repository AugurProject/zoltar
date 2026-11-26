import Inv32NewtonBody
open SolidCore.Solidity.Source Inv32Scalar Inv32Product Inv32Actions Inv32NewtonBody
namespace Inv32NewtonSeed
def xorF := binary .bitXor (by intro h; cases h) (by intro h; cases h)
def formula := clean (xorF (twice (mulF (literal 3) den)) (literal 2))
def declaration : Stmt := .varDecl .uint256 "inverse" (some formula.core)
theorem atSeed : Inv32FloorStart.instructions[16]? = some declaration := by rfl

theorem xorWord (a b : W) :
    BinaryOp.apply false .bitXor (.word a.toNat) (.word b.toNat) = .ok (.word (a ^^^ b).toNat) := by
  simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,Inv32Execution.xorWord,Bind.bind,Except.bind]
theorem binaryValue (op : BinaryOp) (na no) (env : Env) (x y : Formula) (a b v : W)
    (hx : x.run false env = some a.toNat) (hy : y.run false env = some b.toNat)
    (opv : op.apply false (.word a.toNat) (.word b.toNat) = .ok (.word v.toNat)) :
    (binary op na no x y).run false env = some v.toNat := by
  simp only [binary,hx,hy]
  change projectWord (op.apply false (.word a.toNat) (.word b.toNat)) = _
  rw [opv]; rfl
theorem value (d : W) (env : Env) (hd : env "denominator" = some d.toNat) :
    formula.run false env = some (Inv32Newton.seed d).toNat := by
  have h := Inv32ProductValues.cleanup (localWord "denominator") false env _ d.isLt hd
  apply Inv32ProductValues.cleanup _ _ _ _ (Inv32Newton.seed d).isLt
  apply binaryValue _ _ _ _ _ _ (3*d) 2 _ _ rfl (xorWord _ _)
  apply double
  exact binaryValue _ _ _ _ _ _ 3 d _ rfl h (mulWord _ _)

theorem declarationExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : W)
    (u : c.checked = false) (hd : locals r "denominator" = some d.toNat) :
    Stmt.eval (n+1) t c r declaration = pure (.normal (put r (Inv32Newton.seed d))) := by
  have h := evalFormula formula c r _ (by decide) (u ▸ value _ _ hd)
  unfold declaration
  rw [Stmt.eval]; dsimp only; rw [h]; rfl

theorem seedAndSix (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : W)
    (ss : List Stmt) (u : c.checked = false) (hd : locals r "denominator" = some d.toNat) :
    Stmt.evalList (n+1) t c r (((Inv32FloorStart.instructions.drop 16).take 7) ++ ss) =
    Stmt.evalList (n+1) t c (put r (Inv32Newton.iterate d 6)) ss := by
  change Stmt.evalList _ _ _ _ (declaration :: (List.replicate 6 step ++ ss)) = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ (declarationExec _ _ _ _ d u hd)]
  exact iterateSteps _ _ _ _ _ _ _ u hd
end Inv32NewtonSeed
