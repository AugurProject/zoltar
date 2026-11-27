import Inv48MinimaCeilFormula
import Inv03Expressions
import Inv32Midpoint
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Scalar Inv32QuoteExpr
namespace Inv48.MinimaCeil

def predWord (x : Nat) := if x=0 then R-1 else x-1
def sub := nonnegativeSub (w "a") (literal 1)
def div := Inv32Midpoint.quotient sub (w "b")
def add := Inv32Midpoint.plus div (literal 1)

theorem predFits (x : Nat) (h : x<R) : predWord x<R := by
  unfold predWord
  split
  · decide
  · exact lt_of_le_of_lt (Nat.sub_le _ _) h

theorem subtraction (x : Nat) (h : x<R) :
    BinaryOp.apply false .sub (.word x) (.word 1) = .ok (.word (predWord x)) := by
  have op := Inv32ProductValues.subWord x 1 h (by decide)
  have eq : (x+R-1)%R = predWord x := by
    unfold predWord
    by_cases zero : x=0
    · subst x; decide
    · rw [if_neg zero,show x+R-1=x-1+R by omega,Nat.add_mod_right,Nat.mod_eq_of_lt (by omega)]
  exact op.trans (congrArg (fun n => Except.ok (Value.word n)) eq)

theorem addValue (x : Nat) (small : x<R) (env : Env) (X : env "a" = some x) (B : env "b" = some 100) :
    add.run false env = some (predWord x/100+1) := by
  have h := predFits x small
  have ex := Inv32ProductValues.cleanup (localWord "a") false env _ small X
  have eb := Inv32ProductValues.cleanup (localWord "b") false env _ (by decide : 100<R) B
  have one : (literal 1).run false env = some 1 := rfl
  have subv : sub.run false env = some (predWord x) := by
    apply Inv32ProductValues.cleanup _ _ _ _ h; apply Inv32ProductValues.cleanup _ _ _ _ h
    simp [Inv32Product.subF,binary,w,ex,one,subtraction x small,projectWord]
  have dh := lt_of_le_of_lt (Nat.div_le_self (predWord x) 100) h
  have dv : div.run false env = some (predWord x/100) := by
    apply Inv32ProductValues.cleanup _ _ _ _ dh; apply Inv32ProductValues.cleanup _ _ _ _ dh
    simp only [Inv32FloorNarrow.divF,binary,subv,w,eb]
    change projectWord (BinaryOp.apply false .div (.word (predWord x)) (.word 100)) = _
    rw [Inv32Eval.divideWords false _ _ h (by decide) (by decide)]; rfl
  have ah : predWord x/100+1<R := (scaledFactor x small).1
  apply Inv32ProductValues.cleanup _ _ _ _ ah; apply Inv32ProductValues.cleanup _ _ _ _ ah
  simp only [Inv32WideWords.addF,binary,dv,one]
  change projectWord (BinaryOp.apply false .add (.word (predWord x/100)) (.word 1)) = _
  rw [Inv32CompareValues.addWord _ _ dh (by decide),Nat.mod_eq_of_lt ah]; rfl
end Inv48.MinimaCeil
