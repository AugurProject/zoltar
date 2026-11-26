import Inv03Bodies
import Inv32CompareValues

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions Inv32QuoteExpr
namespace Inv03.Expressions
theorem zeros (c : Context) (r : Runtime) (a b : String) (x y : Nat) (hx : x<R) (hy : y<R)
    (X : locals r a = some x) (Y : locals r b = some y) :
    Expr.eval c r (Bodies.zeros a b).value = pure (.word (boolWord (decide (x=0 ∨ y=0))),r) := by
  let z := Inv32WideGuards.zeroTest
  let cond := Expr.binary .boolOr (z a).core (z b).core
  have ax := Inv32WideGuards.zeroValue c.checked _ a x hx X
  have by' := Inv32WideGuards.zeroValue c.checked _ b y hy Y
  have lhs := (z a).sound cond.orderFuel c r _ _ (of_decide_eq_true rfl) (Inv32QuoteGuard.modeled r) ax
  have rhs := (z b).sound cond.orderFuel c r _ _ (of_decide_eq_true rfl) (Inv32QuoteGuard.modeled r) by'
  change Expr.eval c r cond = _
  unfold Expr.eval cond
  unfold cond at lhs rhs
  rw [Expr.evalFuel,lhs]
  by_cases h : x=0
  · simp only [h,if_true,true_or,decide_true]; rfl
  · simp only [if_neg h]
    change (do let (v,s) ← Expr.evalFuel _ c r (z b).core
               let w ← liftM v.expectWord
               pure (Value.word (boolWord (wordTruthy w)),s)) = _
    rw [rhs]
    by_cases j : y=0 <;> simp [h,j] <;> rfl

def scale := choice (literal 1) (literal (1000000000)) (literal (1000000000))
def product (name : String) := Inv32NewtonBody.twice (Inv32Product.mulF (w name) scale)

private theorem mulWord (ch : Bool) (x y : Nat) (hx : x<R) (hy : y<R) (fits : x*y<R) :
    Source.BinaryOp.apply ch .mul (.word x) (.word y) = .ok (.word (x*y)) := by
  have m := Inv32Execution.mul (bv x) (bv y)
  simp only [BitVec.toNat_mul,BitVec.toNat_ofNat,Nat.mod_eq_of_lt hx,Nat.mod_eq_of_lt hy,
    Nat.mod_eq_of_lt fits] at m
  change checkedMul false x y = .ok (x*y) at m
  have same : checkedMul ch x y = checkedMul false x y := by
    unfold checkedMul
    rw [show Shared.norm x = x from Nat.mod_eq_of_lt hx,show Shared.norm y = y from Nat.mod_eq_of_lt hy,
      if_neg (by simp only [Bool.and_eq_true,decide_eq_true_eq]; exact fun h => Nat.not_le_of_gt fits h.2)]
    rfl
  simp [Source.BinaryOp.apply,Source.BinaryOp.applyWord,Source.BinaryOp.preservesFixedBytesWidth,
    Value.forceAbiLazy,Bind.bind,Except.bind,same,m]

theorem scaled (c : Context) (r : Runtime) (name : String) (v : Nat) (hv : v<R) (fits : v*1000000000<R)
    (V : locals r name = some v) : Expr.eval c r (Bodies.scaledUnits name).value =
      pure (.word (v*1000000000),r) := by
  have op := mulWord c.checked v 1000000000 hv (by decide) fits
  apply evalFormula (product name) c r _ (of_decide_eq_true rfl)
  apply Inv32ProductValues.cleanup _ _ _ _ fits
  apply Inv32ProductValues.cleanup _ _ _ _ fits
  have read := Inv32ProductValues.cleanup (localWord name) c.checked (locals r) _ hv V
  have factor : scale.run c.checked (locals r) = some (1000000000) := rfl
  simp [Inv32Product.mulF,binary,w,read,factor,op,projectWord]
end Inv03.Expressions
