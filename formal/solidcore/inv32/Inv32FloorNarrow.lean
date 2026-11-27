import Inv32FloorStart
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions
namespace Inv32FloorNarrow
def divF := binary .div (by intro h; cases h) (by intro h; cases h)
def quotient := clean (clean (divF (clean (localWord "low")) (clean (localWord "denominator"))))
def testZero := eqF (clean (localWord "high")) (literal 0)
def firstBranch : Source.Stmt := .ifElse testZero.core (.block [.returnValues [quotient.core]]) .skip
theorem atBranch : Inv32FloorStart.instructions[9]? = some firstBranch := by rfl

theorem divide (c : Bool) (a d : Nat) (ha : a < R) (hd : d < R) (pos : 0 < d) :
    Source.BinaryOp.apply c .div (.word a) (.word d) = .ok (.word (a/d)) := by
  have norm : Shared.norm d = d := Nat.mod_eq_of_lt hd
  have word : Shared.divWord a d = a/d := by
    change (((a%R)%R) / ((d%R)%R)) % R = _
    simp [Nat.mod_eq_of_lt ha,Nat.mod_eq_of_lt hd,Nat.mod_eq_of_lt (lt_of_le_of_lt (Nat.div_le_self a d) ha)]
  simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,
    Source.BinaryOp.applyWord,checkedDiv,norm,Nat.ne_of_gt pos,word,Bind.bind,Except.bind]

theorem quotientValue (c : Bool) (e : Env) (a d : Nat) (ha : a < R) (hd : d < R) (pos : 0 < d)
    (lo : e "low" = some a) (den : e "denominator" = some d) : quotient.run c e = some (a/d) := by
  have small := lt_of_le_of_lt (Nat.div_le_self a d) ha
  apply Inv32ProductValues.cleanup _ _ _ _ small
  apply Inv32ProductValues.cleanup _ _ _ _ small
  have l := Inv32ProductValues.cleanup (localWord "low") c e _ ha lo
  have r := Inv32ProductValues.cleanup (localWord "denominator") c e _ hd den
  simp [divF,binary,l,r,divide c a d ha hd pos,projectWord]

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem returnQuotient (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (l d : Nat)
    (hl : l < R) (hd : d < R) (pos : 0 < d) (lo : locals r "low" = some l)
    (den : locals r "denominator" = some d) :
    Stmt.eval (n+1) t c r (.returnValues [quotient.core]) = pure (.returned r [.word (l/d)]) := by
  have ev := evalFormula quotient c r (l/d) (by decide) (quotientValue _ _ _ _ hl hd pos lo den)
  have ret : Expr.evalReturnValue c r quotient.core = pure (.word (l/d),r) := ev
  have vals : Expr.evalReturnList c r [quotient.core] = pure ([.word (l/d)],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [quotient.core] = _
    simp only [Expr.evalReturnListFuel,ret,pb]
  rw [Stmt.eval]; dsimp only; rw [vals]; rfl

theorem run (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (l d : Nat)
    (hl : l < R) (hd : d < R) (pos : 0 < d) (lo : locals r "low" = some l)
    (den : locals r "denominator" = some d) (high : locals r "high" = some 0) :
    Stmt.eval (n+3) t c r firstBranch = pure (.returned r [.word (l/d)]) := by
  have cl := Inv32ProductValues.cleanup (localWord "high") c.checked (locals r) 0 (by decide) high
  have z : testZero.run c.checked (locals r) = some 1 := by
    simp only [testZero,eqF,binary,cl,literal]
    cases c.checked <;> rfl
  have guard := evalFormula testZero c r 1 (by decide) z
  unfold firstBranch
  rw [Inv32Blocks.branch _ _ _ _ _ _ _ true guard]
  simp only [ite_true]
  rw [Stmt.eval]; dsimp only
  have out := returnQuotient n t c r.pushScope l d hl hd pos lo den
  rw [Stmt.evalList,out]; rfl
end Inv32FloorNarrow
