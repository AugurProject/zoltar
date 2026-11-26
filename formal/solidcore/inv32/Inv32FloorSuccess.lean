import Inv32WidePath
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32FloorFastPath Inv32FloorStart Inv32FactorRun Inv32WidePath
namespace Inv32FloorSuccess
theorem wideExecAt (table : FunctionTable) (linked : Inv32Internal.ProductLinked table) (n : Nat) (c : Context) (r : Runtime) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (hi : 0<x*y/R) (fits : x*y/R<d) :
    ∃ next, sameEffects next r ∧ Stmt.eval (n+12) table c
      (scope r x y d) Inv32Bodies.Floor.body = pure (.returned next [.word (x*y/d)]) := by
  let t := table
  let outside := (scope r x y d).pushScope
  let inner := outside.pushScope
  let vs := [Value.word (x*y/d)]
  obtain ⟨next,effects,h⟩ := tailAt table linked n c r x y d hx hy hd hi fits
  have inside := blockReturned _ t {c with checked := false} inner next _ vs h
  have un : Stmt.eval (n+10) t c inner (.unchecked (.block instructions)) =
      pure (.returned next.popScope vs) := by rw [Stmt.eval]; exact inside
  have body := blockReturned _ t c outside _ _ vs (stop _ _ _ _ _ _ [] _ un)
  refine ⟨next.popScope.popScope.popScope, fun ls => ?_, ?_⟩
  · exact effects ls
  change Stmt.eval _ _ _ _ (.block [cleanParam "x",cleanParam "y",cleanParam "denominator",.skip,
    .block [.unchecked (.block instructions)]]) = _
  apply blockReturned (n+11) t c _ next.popScope.popScope _ vs
  have A := cleanParamExec (n+10) t c outside "x" x hx rfl (by dsimp [outside]; write_param)
  have B := cleanParamExec (n+10) t c outside "y" y hy rfl (by dsimp [outside]; write_param)
  have D := cleanParamExec (n+10) t c outside "denominator" d hd rfl (by dsimp [outside]; write_param)
  have sk : Stmt.eval (n+11) t c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
  rw [seqStep _ _ _ _ _ _ _ A,seqStep _ _ _ _ _ _ _ B,seqStep _ _ _ _ _ _ _ D,seqStep _ _ _ _ _ _ _ sk]
  exact stop _ _ _ _ _ _ [] _ body

theorem executionAt (table : FunctionTable) (linked : Inv32Internal.ProductLinked table) (fuel : Nat) (c : Context) (r : Runtime) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (pos : 0<d) (fits : x*y/d<R) (enough : 12≤fuel) :
    ∃ next, sameEffects next r ∧ Stmt.eval fuel table c (scope r x y d) Inv32Bodies.Floor.body =
      pure (.returned next [.word (x*y/d)]) := by
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le enough
  rw [Nat.add_comm 12 n]
  by_cases small : x*y<R
  · exact ⟨scope r x y d,fun _ => rfl,Inv32FloorFastPath.executionAt table linked _ _ _ _ _ _ hx hy hd pos small⟩
  · apply wideExecAt table linked _ _ _ _ _ _ hx hy hd
    · exact Nat.div_pos (Nat.le_of_not_gt small) (Nat.two_pow_pos 256)
    · apply (Nat.div_lt_iff_lt_mul (Nat.two_pow_pos 256)).mpr
      rw [Nat.mul_comm d (2^256)]
      exact (Nat.div_lt_iff_lt_mul pos).mp fits
end Inv32FloorSuccess
