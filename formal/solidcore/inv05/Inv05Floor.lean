import Inv05RejectionLinks
import Inv32FloorOverflow
import Inv05Expressions
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32OneArg Inv32FloorStart
namespace Inv05
/-- The actual settlement table rejects a quotient too wide for the return word. -/
theorem floorOverflow (n : Nat) (c : Context) (r : Runtime) (dst : String) (ex ey ed : Expr)
    (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d) (large : R≤x*y/d)
    (args : Inputs c r dst ex ey ed x y d) :
    ∃ next err, Stmt.eval (n+25) Inv03.model.core.table c (store r dst 0) (code dst ex ey ed) =
      pure (.reverted next err) := by
  obtain ⟨next,err,ev⟩ := Inv32FloorOverflow.callAt _ rejectionLinks n c
    (state r dst 0 x y d 0) a0 a1 a2 [ret] x y d hx hy hd hp large rfl rfl rfl
  have cap := Inv32Revert.capture _ _ _ _ _ _ [ret] _ ev
  exact ⟨next.popScope,err,Inv32Revert.blockRevert _ _ _ _ _ _ _ ((bindArgs (n+23) _ _ _ _ _ _ _ _ _ _ _ args).trans
    (Inv32Revert.stop _ _ _ _ _ _ [.assign (.var dst) (.var ret)] _ cap))⟩

/-- The value re-read by the Solidity precision guard fits even if the first product is wide. -/
theorem precisionBound (cash units net : Nat) :
    let scaled := cash*10^9
    let added := scaled*units/net
    added*net/units ≤ scaled := by
  dsimp only
  apply Nat.div_le_of_le_mul
  rw [Nat.mul_comm units (cash*10^9)]
  exact Nat.div_mul_le_self _ _
end Inv05
