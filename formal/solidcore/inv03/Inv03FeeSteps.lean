import Inv03RawValue

open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Scalar Inv32QuoteExpr
namespace Inv03

theorem enumArg (c : Context) (r : Runtime) (b : Bool) :
    Expr.eval c r (Bodies.enumWord (boolWord b)).value = pure (.word (boolWord b),r) := by
  let v := boolWord b
  have fit : v<R := by cases b <;> decide
  have lit : Expr.evalFuel 2 c r (.word v) = pure (.word v,r) := by
    rw [Expr.evalFuel]; cases b <;> rfl
  have clean := Inv32Guards.clean 2 c r (.word v) v fit lit
  change Expr.evalFuel 4 c r (.enumFromUInt 3 (.castOp .uintCleanup 256 (.word v))) = _
  rw [Expr.evalFuel,clean]; cases b <;> rfl

theorem ceilHoist (n : Nat) (c : Context) (r : Runtime) (ex ey ed : Expr) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d) (fits : ceilQuot (x*y) d<R)
    (args : Inv32FloorHoist.Inputs c r Bodies.tmp ex ey ed x y d) :
    Stmt.eval (n+20) model.core.table c (Inv32OneArg.store r Bodies.tmp 0)
      (Hoist.code Inv32Bodies.Ceil.key Inv32CeilHoist.dest ex ey ed (Bodies.enumWord 1).value) =
      pure (.normal (Inv32OneArg.store r Bodies.tmp (ceilQuot (x*y) d))) := by
  let st := Hoist.frame r Inv32CeilHoist.dest 0 x y d 1 0
  have ev := roundedCall n c st Inv32FloorHoist.a0 Inv32FloorHoist.a1 Inv32FloorHoist.a2 Inv32CeilHoist.a3
    [Inv32CeilHoist.dest] x y d true hx hy hd hp (by rwa [roundedCeil _ _ _ hp]) rfl rfl rfl rfl
  rw [roundedCeil _ _ _ hp] at ev
  exact Hoist.run (n+17) _ c r _ _ _ _ _ _ x y d 1 _ args (enumArg c _ true) (by decide) ev

def greater (a b : String) := Inv32WideGuards.gtF (w a) (w b)
theorem greaterRead (c : Context) (r : Runtime) (a b : String) (x y : Nat) (hx : x<R) (hy : y<R)
    (X : locals r a = some x) (Y : locals r b = some y) :
    Expr.eval c r (greater a b).core = pure (.word (boolWord (decide (y<x))),r) := by
  have A := Inv32ProductValues.cleanup (localWord a) c.checked (locals r) _ hx X
  have B := Inv32ProductValues.cleanup (localWord b) c.checked (locals r) _ hy Y
  apply evalFormula (greater a b) c r _ (of_decide_eq_true rfl)
  simp [greater,Inv32WideGuards.gtF,binary,w,A,B,Inv32QuoteExpr.gt _ _ _ hx hy,projectWord,boolWord]
end Inv03
