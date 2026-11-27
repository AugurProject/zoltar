import Inv32FloorHoist
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32CeilFlags
namespace Inv32CeilAdd
def q := clean (localWord h2)
def flag := clean (localWord h3)
def sum := Inv32WideWords.addF q flag
def checkedSum := Inv32NewtonBody.twice sum
def ret : Stmt := .returnValues [checkedSum.core]
theorem location : ss[7]? = some ret := by rfl
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem good (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (a b : Nat) (ha : a<R) (hb : b<R)
    (small : a+b<R) (ch : c.checked=true) (A : locals r h2 = some a) (B : locals r h3 = some b) :
    Stmt.eval (n+1) t c r ret = pure (.returned r [.word (a+b)]) := by
  have V : BinaryOp.applyWord true .add a b = .ok (a+b) := by
    have h := Inv32Rounding.addition a b ha hb
    rw [if_pos small] at h
    cases z : BinaryOp.applyWord true .add a b <;> simp_all [Except.toOption]
  have add : BinaryOp.apply true .add (.word a) (.word b) = .ok (.word (a+b)) := by
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,V,Bind.bind,Except.bind]
  have T := Inv32ProductValues.cleanup (localWord h2) true (locals r) _ ha A
  have F := Inv32ProductValues.cleanup (localWord h3) true (locals r) _ hb B
  have run : checkedSum.run c.checked (locals r) = some (a+b) := by
    rw [ch]; apply Inv32ProductValues.cleanup _ _ _ _ small; apply Inv32ProductValues.cleanup _ _ _ _ small
    simp [sum,Inv32WideWords.addF,binary,q,flag,T,F,add,projectWord]
  have leaf := evalFormula checkedSum c r (a+b) (by decide) run
  have e : Expr.evalReturnValue c r checkedSum.core = pure (.word (a+b),r) := leaf
  have vs : Expr.evalReturnList c r [checkedSum.core] = pure ([.word (a+b)],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [checkedSum.core] = _
    simp only [Expr.evalReturnListFuel,e,pb]
  unfold ret; rw [Stmt.eval]; dsimp only; rw [vs]; rfl
theorem bad (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (a b : Nat) (ha : a<R) (hb : b<R)
    (large : R≤a+b) (ch : c.checked=true) (A : r.lookupLocal? h2 = some (.word a)) (B : r.lookupLocal? h3 = some (.word b)) :
    Stmt.eval (n+1) t c r ret = pure (.reverted r .overflow) := by
  have raw : checkedAdd true a b = .error .overflow := by
    simp only [checkedAdd,show SolidCore.Solidity.Shared.norm a = a from Nat.mod_eq_of_lt ha,
      show SolidCore.Solidity.Shared.norm b = b from Nat.mod_eq_of_lt hb]
    rw [if_pos (by simpa using large)]
  have h : BinaryOp.apply c.checked .add (.word a) (.word b) = .error .overflow := by
    simp [ch,BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,BinaryOp.applyWord,raw,Bind.bind,Except.bind]
  have sumThrows (k : Nat) : Expr.evalFuel (k+3) c r sum.core = throw (SolidityFailure.revert .overflow) := by
    change Expr.evalFuel _ _ _ (.binary .add q.core flag.core) = _
    rw [Expr.evalFuel]
    have Qa : Expr.evalFuel (k+2) c r q.core = pure (.word a,r) := Inv32Guards.clean _ _ _ _ _ ha (Inv32Guards.readWord _ _ _ _ _ A)
    have Fb : Expr.evalFuel (k+2) c r flag.core = pure (.word b,r) := Inv32Guards.clean _ _ _ _ _ hb (Inv32Guards.readWord _ _ _ _ _ B)
    simp only [Qa,Fb,pb,h]; rfl
    all_goals intro h; cases h
  have thrown : Expr.evalReturnValue c r checkedSum.core = throw (SolidityFailure.revert .overflow) := by
    change Expr.evalFuel (_+3+1+1) c r (.castOp .uintCleanup 256 (.castOp .uintCleanup 256 sum.core)) = _
    rw [Expr.evalFuel,Expr.evalFuel,sumThrows]; rfl
  have vs : Expr.evalReturnList c r [checkedSum.core] = throw (SolidityFailure.revert .overflow) := by
    change Expr.evalReturnListFuel (_+1+1) c r [checkedSum.core] = _
    rw [Expr.evalReturnListFuel,thrown]; rfl
  unfold ret; rw [Stmt.eval]; dsimp only; rw [vs]; rfl
end Inv32CeilAdd
