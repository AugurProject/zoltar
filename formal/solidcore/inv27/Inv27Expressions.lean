import Inv27Shapes
import Inv32Midpoint
open SolidCore.Solidity.Source Inv32Scalar Inv32Actions Inv32QuoteExpr Inv32Division
namespace Inv27
def prec := choice (literal 1) (literal D) (literal D)
theorem precisionValue (c : Context) (r : Runtime) :
    Expr.eval c r precision.value = pure (.word D,r) :=
  evalFormula prec c r D (by decide) rfl
theorem checkedValue (c : Context) (r : Runtime) (name : String) (v : Nat)
    (fit : v<R) (found : locals r name = some v) :
    Expr.eval c r (Inv03.Bodies.wvar name).value = pure (.word v,r) :=
  evalFormula (w name) _ _ v (by change 2 ≤ 3; decide) (Inv32ProductValues.cleanup (localWord name) _ _ _ fit found)
theorem denomMinus (c : Context) (r : Runtime) (e : Nat) (ok : e<D)
    (found : locals r "uncertainty" = some e) :
    Expr.eval c r (arithmetic Inv32Shapes.BinaryOp_sub).value = pure (.word (D-e),r) :=
  evalFormula (nonnegativeSub prec (w "uncertainty")) _ _ _ (by decide)
    (subValue _ _ _ _ _ _ (by decide) (lt_trans ok (by decide)) (Nat.le_of_lt ok) rfl
      (Inv32ProductValues.cleanup (localWord _) _ _ _ (lt_trans ok (by decide)) found))
theorem denomPlus (c : Context) (r : Runtime) (e : Nat) (ok : e<D) (checked : c.checked=true)
    (found : locals r "uncertainty" = some e) :
    Expr.eval c r (arithmetic Inv32Shapes.BinaryOp_add).value = pure (.word (D+e),r) := by
  have fit : D+e<R := lt_of_lt_of_le (Nat.add_lt_add_left ok D) (by decide)
  apply evalFormula (Inv32Midpoint.plus prec (w "uncertainty")) _ _ _ (by decide)
  rw [checked]
  exact Inv32Midpoint.plusValue _ _ _ _ _ (by decide) (lt_trans ok (by decide)) fit rfl
    (Inv32ProductValues.cleanup (localWord _) _ _ _ (lt_trans ok (by decide)) found)
theorem maximumLiteral (c : Context) (r : Runtime) :
    Expr.eval c r (Inv03.Bodies.clean (Inv03.Bodies.num M)).value = pure (.word M,r) :=
  evalFormula (Inv32Product.clean (literal M)) _ _ M (by decide)
    (Inv32ProductValues.cleanup _ _ _ _ (by decide) rfl)
theorem guardExec (n : Nat) (c : Context) (r : Runtime) (e : Nat) (fit : e<R)
    (found : locals r "uncertainty"=some e) :
    Stmt.eval (n+1) Inv03.model.core.table c r guard.value =
    pure (if e<D then .normal r else .reverted r (.error "Invalid oracle uncertainty")) := by
  have read := evalFormula (Inv32Product.ltF (w "uncertainty") prec) c r _ (by decide)
    (comparison _ _ _ _ _ _ fit (by decide : D<R)
      (Inv32ProductValues.cleanup (localWord _) _ _ _ fit found) rfl)
  simpa using Inv32QuoteGuard.requireEval n Inv03.model.core.table c r _ _ "Invalid oracle uncertainty" read
theorem priceGuardExec (n : Nat) (c : Context) (r : Runtime) (p m : Nat) (hp : p<R) (hm : m<R)
    (P : locals r "price" = some p) (M' : locals r "maximumPrice" = some m) :
    Stmt.eval (n+1) Inv03.model.core.table c r priceGuard.value =
    pure (if p≤m then .normal r else .reverted r (.error "Conservative oracle price exceeds uint256")) := by
  have check : BinaryOp.apply c.checked .le (.word p) (.word m) = .ok (.word (if p≤m then 1 else 0)) :=
    Inv32WideGuards.leWord _ _ hp hm
  have a := Inv32ProductValues.cleanup (localWord "price") c.checked (locals r) _ hp P
  have b := Inv32ProductValues.cleanup (localWord "maximumPrice") c.checked (locals r) _ hm M'
  have read := evalFormula (Inv32WideGuards.leF (w "price") (w "maximumPrice")) c r (boolWord (decide (p≤m))) (by decide)
    (by simp [Inv32WideGuards.leF,binary,w,a,b,check,projectWord,boolWord])
  simpa using Inv32QuoteGuard.requireEval n Inv03.model.core.table c r _ _ "Conservative oracle price exceeds uint256" read
end Inv27
