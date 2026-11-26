import Inv32WideFinish
open SolidCore.Solidity.Source Inv32Scalar Inv32Product Inv32Division Inv32Actions
open Inv32WideGuards Inv32FloorNarrow Inv32FloorStart
namespace Inv32WideEntry
def failureBranch := match instructions[10]? with
  | some (.ifElse _ yes _) => yes
  | _ => .skip
def overflowTest := leF (clean (localWord "denominator")) (clean (localWord "high"))
def overflow : Stmt := .ifElse overflowTest.core failureBranch .skip
theorem atGuard : instructions[10]? = some overflow := by rfl
private theorem bypass (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (yes : Stmt)
    (f : Formula) (sz : f.depth ≤ f.core.orderFuel+1) (h : f.run c.checked (locals r) = some 0) :
    Stmt.eval (n+2) t c r (.ifElse f.core yes .skip) = pure (.normal r) := by
  have v := evalFormula f c r 0 sz h
  rw [Inv32Blocks.branch _ _ _ _ _ _ _ false v]; rw [if_neg (by decide),Stmt.eval]
theorem narrowMiss (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (hi : Nat)
    (hr : hi<R) (hp : 0<hi) (H : locals r "high" = some hi) :
    Stmt.eval (n+2) t c r firstBranch = pure (.normal r) := by
  apply bypass _ _ _ _ _ testZero (by decide)
  exact (if_neg (Nat.ne_of_gt hp) : (if hi=0 then 1 else 0) = 0) ▸ zeroValue c.checked (locals r) "high" hi hr H
theorem overflowMiss (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (hi d : Nat)
    (hr : hi<R) (dr : d<R) (ok : hi<d) (u : c.checked = false)
    (H : locals r "high" = some hi) (D : locals r "denominator" = some d) :
    Stmt.eval (n+2) t c r overflow = pure (.normal r) := by
  apply bypass _ _ _ _ _ overflowTest (by decide)
  rw [u]
  have h := Inv32ProductValues.cleanup (localWord "high") false (locals r) _ hr H
  have dd := Inv32ProductValues.cleanup (localWord "denominator") false (locals r) _ dr D
  simp [overflowTest,leF,binary,h,dd,leWord d hi dr hr,Nat.not_le_of_gt ok,projectWord]
theorem lowBitPos (d : Inv32NewtonBody.W) (h : 0<d.toNat) : 0<(d &&& -d).toNat := by
  have ne : d ≠ 0 := by intro z; subst d; contradiction
  have nonzero : d &&& -d ≠ 0 := by
    change (d &&& (0 - d) : BitVec 256) ≠ 0
    bv_decide
  apply Nat.pos_of_ne_zero
  intro z
  exact nonzero (BitVec.eq_of_toNat_eq z)
end Inv32WideEntry
