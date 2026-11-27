import Inv32WideGuards
open SolidCore.Solidity.Source Inv32Scalar Inv32Product Inv32NewtonBody Inv32Division Inv32Actions Inv32WideGuards
namespace Inv32Borrow
def m := clean (localWord "remainder")
def h := clean (localWord "high")
def l := clean (localWord "low")
def productMod := modularProduct (localWord "x") (localWord "y") (localWord "denominator")
def borrow := choice (gtF m l) (literal 1) (literal 0)
def update := block [
  conditional (zeroTest "denominator") (by decide) (writeLiteral "remainder" 0)
    (writeCast "remainder" .cleanup 256 productMod (by decide)),
  writeCast "high" .cleanup 256 (clean (subF h borrow)) (by decide),
  writeCast "low" .cleanup 256 (clean (subF l m)) (by decide)]
theorem location : Inv32FloorStart.instructions[12]? = some update.core := by rfl
theorem modValue (env : Env) (x y d : Nat) (hx : x < R) (hy : y < R) (hd : d < R) (pos : 0 < d)
    (X : env "x" = some x) (Y : env "y" = some y) (D : env "denominator" = some d) :
    productMod.run false env = some (x*y%d) := by
  have a : normWord x = x := Nat.mod_eq_of_lt hx
  have b : normWord y = y := Nat.mod_eq_of_lt hy
  have c : normWord d = d := Nat.mod_eq_of_lt hd
  simp [productMod,modularProduct,localWord,X,Y,D,a,b,c,Inv32Rounding.remainder _ _ _ hx hy hd pos]; rfl
theorem borrowValue (env : Env) (rem low : Nat) (mr : rem < R) (lr : low < R)
    (M : env "remainder" = some rem) (L : env "low" = some low) :
    borrow.run false env = some (if low<rem then 1 else 0) := by
  have a := Inv32ProductValues.cleanup (localWord "remainder") false env _ mr M
  have b := Inv32ProductValues.cleanup (localWord "low") false env _ lr L
  have g : (gtF m l).run false env = some (if low<rem then 1 else 0) := by
    simp [gtF,m,l,binary,a,b,gtWord _ _ mr lr,projectWord]
  unfold borrow choice; dsimp only; rw [g]
  by_cases yes : low<rem <;> simp only [yes,if_true,if_false] <;> rfl
theorem subValue (env : Env) (a b : Formula) (x y : Nat) (hx : x < R) (hy : y < R)
    (A : a.run false env = some x) (B : b.run false env = some y) :
    (twice (subF a b)).run false env = some ((x+R-y)%R) := by
  have small := Nat.mod_lt (x+R-y) (Nat.two_pow_pos 256)
  apply Inv32ProductValues.cleanup _ _ _ _ small
  apply Inv32ProductValues.cleanup _ _ _ _ small
  simp [subF,binary,A,B,Inv32ProductValues.subWord _ _ hx hy,projectWord]; rfl
end Inv32Borrow
