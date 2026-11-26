import Inv39ChildBody
import Inv40Evaluation
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Child
def cv (x : String) := (Inv03.Bodies.wvar x).value
theorem readClean (n : Nat) (c : Context) (r : Runtime) (x : String) (v : Nat) (fit : v<R) (look : r.lookupLocal? x=some (.word v)) :
    (cv x).evalFuel (n+2) c r = pure (.word v,r) :=
  Inv32Guards.clean _ _ _ _ _ fit (Inv32Guards.readWord _ _ _ _ _ look)
def sumExpr := Source.Expr.castOp .uintCleanup 256 (.castOp .uintCleanup 256 (.binary .add (cv "#view1586") (cv "#operand1587")))
def capExpr := Source.Expr.binary .le (cv "#operand1588") (cv "#operand1589")
theorem sumRead (n : Nat) (c : Context) (r : Runtime) (x y : Nat)
    (fit : x+y<R) (X : r.lookupLocal? "#view1586"=some (.word x)) (Y : r.lookupLocal? "#operand1587"=some (.word y)) :
    sumExpr.evalFuel (n+5) c r = pure (.word (x+y),r) := by
  exact Inv32Guards.clean _ _ _ _ _ fit (Inv32Guards.clean _ _ _ _ _ fit (Inv32Eval.binary _ _ _ .add
    (by intro h; cases h) (by intro h; cases h) _ _ _ _ _ (readClean n _ _ _ _ (by omega) X) (readClean n _ _ _ _ (by omega) Y) (Inv40.addWords _ _ _ fit)))
theorem capRead (n : Nat) (c : Context) (r : Runtime) (x y : Nat) (xfit : x<R) (yfit : y<R)
    (X : r.lookupLocal? "#operand1588"=some (.word x)) (Y : r.lookupLocal? "#operand1589"=some (.word y)) :
    capExpr.evalFuel (n+3) c r = pure (.word (boolWord (x≤y)),r) := by
  have cmp : Source.BinaryOp.apply c.checked .le (.word x) (.word y) = .ok (.word (boolWord (x≤y))) := by
    change Source.BinaryOp.apply false .le _ _ = _
    have h := Inv32WideGuards.leWord x y xfit yfit
    by_cases yes : x≤y <;> simpa [yes,boolWord] using h
  exact Inv32Eval.binary _ _ _ .le (by intro h; cases h) (by intro h; cases h) _ _ _ _ _ (readClean n _ _ _ _ xfit X) (readClean n _ _ _ _ yfit Y) cmp
end Inv39.Child
