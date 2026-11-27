import Inv32CompareCall
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32QuoteExpr
namespace Inv32Midpoint
def plus (a b : Formula) := Inv32NewtonBody.twice (Inv32WideWords.addF a b)
def quotient (a b : Formula) := Inv32NewtonBody.twice (Inv32FloorNarrow.divF a b)
def delta := nonnegativeSub (w "high") (w "low")
def expr := plus (plus (w "low") (quotient delta (literal 2))) (literal 1)
def mid (l h : Nat) := l+(h-l)/2+1
theorem plusValue (env : Env) (x y : Formula) (a b : Nat) (ha : a<R) (hb : b<R) (sum : a+b<R)
    (X : x.run true env = some a) (Y : y.run true env = some b) :
    (plus x y).run true env = some (a+b) := by
  have V : BinaryOp.applyWord true .add a b = .ok (a+b) := by
    have h := Inv32Rounding.addition a b ha hb
    rw [if_pos sum] at h; cases z : BinaryOp.applyWord true .add a b <;> simp_all [Except.toOption]
  have calc' : BinaryOp.apply true .add (.word a) (.word b) = .ok (.word (a+b)) := by
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,V,Bind.bind,Except.bind]
  apply Inv32ProductValues.cleanup _ _ _ _ sum; apply Inv32ProductValues.cleanup _ _ _ _ sum
  simp [Inv32WideWords.addF,binary,X,Y,calc',projectWord]
theorem divValue (env : Env) (x y : Formula) (a b : Nat) (ha : a<R) (hb : b<R) (pos : 0<b)
    (X : x.run true env = some a) (Y : y.run true env = some b) :
    (quotient x y).run true env = some (a/b) := by
  have small := lt_of_le_of_lt (Nat.div_le_self a b) ha
  apply Inv32ProductValues.cleanup _ _ _ _ small; apply Inv32ProductValues.cleanup _ _ _ _ small
  simp [Inv32FloorNarrow.divF,binary,X,Y,Inv32Eval.divideWords true _ _ ha hb pos,projectWord]
theorem value (env : Env) (l h : Nat) (open' : l<h) (hr : h<R) (L : env "low" = some l)
    (H : env "high" = some h) : expr.run true env = some (mid l h) := by
  have lr := lt_trans open' hr
  have D := subValue true env _ _ _ _ hr lr (Nat.le_of_lt open')
    (Inv32ProductValues.cleanup (localWord "high") true env _ hr H) (Inv32ProductValues.cleanup (localWord "low") true env _ lr L)
  have dr : h-l<R := lt_of_le_of_lt (Nat.sub_le _ _) hr
  have half := divValue env delta (literal 2) (h-l) 2 dr (by decide) (by decide) D rfl
  have bound : l+(h-l)/2<h := by omega
  have first := plusValue env (w "low") (quotient delta (literal 2)) _ _ lr
    (lt_of_le_of_lt (Nat.div_le_self _ _) dr) (lt_trans bound hr) (Inv32ProductValues.cleanup (localWord "low") _ _ _ lr L) half
  exact plusValue env _ (literal 1) _ 1 (lt_trans bound hr) (by decide) (by omega) first rfl
end Inv32Midpoint
