import Inv05MintShape
import Inv03Expressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Scalar Inv32QuoteExpr
namespace Inv05
theorem earlier (c : Context) (r : Runtime) (cash : Nat) (h : cash<R) (pos : 0<cash)
    (fits : cash*(10^9)<R) (lookup : locals r "cash" = some cash) :
    Expr.eval c r previous.value = pure (.word ((cash-1)*(10^9)),r) := by
  let sub := nonnegativeSub (w "cash") (literal 1)
  let expr := Inv32NewtonBody.twice (Inv32Product.mulF sub Inv03.Expressions.scale)
  have small : cash-1<R := lt_of_le_of_lt (Nat.sub_le _ _) h
  have bound : (cash-1)*(10^9)<R := lt_of_le_of_lt (Nat.mul_le_mul_right _ (Nat.sub_le _ _)) fits
  have first := subValue c.checked (locals r) (w "cash") (literal 1) cash 1 h (by decide) pos
    (Inv32ProductValues.cleanup _ _ _ _ h lookup) rfl
  exact evalFormula expr c r _ (by decide) (Inv03.Expressions.scaleValue sub _ _ _ small bound first)
end Inv05
