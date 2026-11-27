import Inv39SpendShape
import Inv39GuardNumbers
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
theorem cmp (c : Context) (x y : Nat) (xfit : x<R) (yfit : y<R) :
    Source.BinaryOp.apply c.checked .lt (.word x) (.word y)=.ok (.word (boolWord (x<y))) := by
  change Source.BinaryOp.apply false .lt _ _ = _
  have h := Inv32ProductValues.ltWord x y xfit yfit
  by_cases yes : x<y <;> simpa [yes,boolWord] using h
theorem finiteCond (c : Context) (r : Runtime) (x : Nat) (look : r.lookupLocal? "currentAllowance"=some (.word x)) (fit : x<R) :
    finite.value.eval c r=pure (.word (boolWord (x<R-1)),r) := by
  have word : R-1<R := by decide
  have lit : (Source.Expr.word (R-1)).evalFuel 3 c r=pure (.word (R-1),r) := by rw [Expr.evalFuel]; rfl
  exact Inv32Eval.binary _ c r .lt (by intro h; cases h) (by intro h; cases h) _ _ _ _ _
    (Child.readClean _ _ _ _ _ fit look) (Inv32Guards.clean _ _ _ _ _ word lit) (cmp c _ _ fit word)
theorem lowCond (c : Context) (r : Runtime) (x y : Nat) (X : r.lookupLocal? "currentAllowance"=some (.word x))
    (Y : r.lookupLocal? "value"=some (.word y)) (xf : x<R) (yf : y<R) :
    low.value.eval c r=pure (.word (boolWord (x<y)),r) :=
  Inv32Eval.binary _ c r .lt (by intro h; cases h) (by intro h; cases h) _ _ _ _ _
    (Child.readClean _ _ _ _ _ xf X) (Child.readClean _ _ _ _ _ yf Y) (cmp c _ _ xf yf)
theorem reducedValue (c : Context) (r : Runtime) (x y : Nat) (X : r.lookupLocal? "currentAllowance"=some (.word x))
    (Y : r.lookupLocal? "value"=some (.word y)) (xf : x<R) (enough : y≤x) :
    reduced.value.eval c r=pure (.word (x-y),r) := by
  have diff := lt_of_le_of_lt (Nat.sub_le x y) xf
  exact Inv32Guards.clean _ c r _ _ diff (Inv32Guards.clean _ c r _ _ diff (Inv32Eval.binary _ c r .sub (by intro h; cases h) (by intro h; cases h) _ _ _ _ _
    (Child.readClean _ _ _ _ _ xf X) (Child.readClean _ _ _ _ _ (lt_of_le_of_lt enough xf) Y) (Inv32QuoteExpr.subWord _ _ _ xf (lt_of_le_of_lt enough xf) enough)))
end Inv39.Allowance
