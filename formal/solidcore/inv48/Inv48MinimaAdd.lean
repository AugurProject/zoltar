import Inv32FloorHoist
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32CeilFlags
namespace Inv48.MinimaAdd
def q (left : String) := clean (localWord left)
def flag (right : String) := clean (localWord right)
def sum (left right : String) := Inv32WideWords.addF (q left) (flag right)
def checkedSum (left right : String) := Inv32NewtonBody.twice (sum left right)
def ret (left right : String) : Stmt := .returnValues [(checkedSum left right).core]
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem good (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (left right : String) (a b : Nat) (ha : a<R) (hb : b<R)
    (small : a+b<R) (ch : c.checked=true) (A : locals r left = some a) (B : locals r right = some b) :
    Stmt.eval (n+1) t c r (ret left right) = pure (.returned r [.word (a+b)]) := by
  have V : BinaryOp.applyWord true .add a b = .ok (a+b) := by
    have h := Inv32Rounding.addition a b ha hb
    rw [if_pos small] at h
    cases z : BinaryOp.applyWord true .add a b <;> simp_all [Except.toOption]
  have add : BinaryOp.apply true .add (.word a) (.word b) = .ok (.word (a+b)) := by
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,V,Bind.bind,Except.bind]
  have T := Inv32ProductValues.cleanup (localWord left) true (locals r) _ ha A
  have F := Inv32ProductValues.cleanup (localWord right) true (locals r) _ hb B
  have run : (checkedSum left right).run c.checked (locals r) = some (a+b) := by
    rw [ch]; apply Inv32ProductValues.cleanup _ _ _ _ small; apply Inv32ProductValues.cleanup _ _ _ _ small
    simp [sum,Inv32WideWords.addF,binary,q,flag,T,F,add,projectWord]
  have leaf := evalFormula (checkedSum left right) c r (a+b) (by simp [checkedSum,sum,q,flag,Inv32NewtonBody.twice,Inv32WideWords.addF,Inv32Product.clean,Inv32Scalar.localWord,Inv32Scalar.binary,Inv32Scalar.literal,Expr.orderFuel,Inv32Scalar.cast]) run
  have e : Expr.evalReturnValue c r (checkedSum left right).core = pure (.word (a+b),r) := leaf
  have vs : Expr.evalReturnList c r [(checkedSum left right).core] = pure ([.word (a+b)],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [(checkedSum left right).core] = _
    simp only [Expr.evalReturnListFuel,e,pb]
  unfold ret; rw [Stmt.eval]; dsimp only; rw [vs]; rfl
theorem value (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (left right : String) (a b : Nat) (ha : a<R) (hb : b<R)
    (small : a+b<R) (ch : c.checked=true) (A : locals r left = some a) (B : locals r right = some b) :
    Expr.eval c r (checkedSum left right).core = pure (.word (a+b),r) := by
  have V : BinaryOp.applyWord true .add a b = .ok (a+b) := by
    have h := Inv32Rounding.addition a b ha hb
    rw [if_pos small] at h
    cases z : BinaryOp.applyWord true .add a b <;> simp_all [Except.toOption]
  have add : BinaryOp.apply true .add (.word a) (.word b) = .ok (.word (a+b)) := by
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,V,Bind.bind,Except.bind]
  have T := Inv32ProductValues.cleanup (localWord left) true (locals r) _ ha A
  have F := Inv32ProductValues.cleanup (localWord right) true (locals r) _ hb B
  have run : (checkedSum left right).run c.checked (locals r) = some (a+b) := by
    rw [ch]; apply Inv32ProductValues.cleanup _ _ _ _ small; apply Inv32ProductValues.cleanup _ _ _ _ small
    simp [sum,Inv32WideWords.addF,binary,q,flag,T,F,add,projectWord]
  have leaf := evalFormula (checkedSum left right) c r (a+b) (by simp [checkedSum,sum,q,flag,Inv32NewtonBody.twice,Inv32WideWords.addF,Inv32Product.clean,Inv32Scalar.localWord,Inv32Scalar.binary,Inv32Scalar.literal,Expr.orderFuel,Inv32Scalar.cast]) run
  exact leaf
end Inv48.MinimaAdd
