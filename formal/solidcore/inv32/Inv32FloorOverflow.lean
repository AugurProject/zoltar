import Inv32FloorRejection
open SolidCore.Solidity.Source Inv32Division Inv32FloorFastPath Inv32FloorStart Inv32FactorRun Inv32WideEntry
namespace Inv32FloorOverflow
theorem body (n : Nat) (c : Context) (r : Runtime) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (pos : 0<d) (over : R≤x*y/d) :
    ∃ next err, Stmt.eval (n+22) Inv32Dispatch.model.core.table c (scope r x y d) Inv32Bodies.Floor.body = pure (.reverted next err) := by
  let t := Inv32Dispatch.model.core.table
  let outside := (scope r x y d).pushScope
  let inner := outside.pushScope
  let h := x*y/R
  let l := x*y%R
  let after := state inner x y h l h l
  let ctx := {c with checked := false}
  have le : d≤h := by
    apply (Nat.le_div_iff_mul_le (Nat.two_pow_pos 256)).mpr
    rw [Nat.mul_comm d (2^256)]
    exact (Nat.le_div_iff_mul_le pos).mp over
  have hbound : h<R := (Nat.div_lt_iff_lt_mul (Nat.two_pow_pos 256)).mpr
    (lt_of_le_of_lt (Nat.mul_le_mul_right _ (Nat.le_of_lt hx)) (Nat.mul_lt_mul_of_pos_left hy (by decide)))
  have B1 := narrowMiss (n+16) t ctx after h hbound (lt_of_lt_of_le pos le) rfl
  obtain ⟨next,err,B2⟩ := Inv32FloorRejection.overflowTaken n ctx after d h hd hbound le rfl rfl rfl
  have ss : Stmt.evalList (n+18) t ctx inner.pushScope instructions = pure (.reverted next err) := by
    rw [Inv32WideExecution.statements]
    refine (runPrefix (n+16) ctx inner x y hx hy rfl rfl _ (by omega)).trans ?_
    exact (seqStep _ _ _ _ _ _ _ B1).trans (Inv32Revert.stop _ _ _ _ _ _ _ _ B2)
  have inside := Inv32Revert.blockRevert _ t ctx inner _ _ _ ss
  have un : Stmt.eval (n+20) t c inner (.unchecked (.block instructions)) = pure (.reverted next.popScope err) := by
    rw [Stmt.eval]; exact inside
  have blk := Inv32Revert.blockRevert _ t c outside _ _ _ (Inv32Revert.stop _ _ _ _ _ _ [] _ un)
  refine ⟨next.popScope.popScope.popScope,err,?_⟩
  change Stmt.eval _ _ _ _ (.block [cleanParam "x",cleanParam "y",cleanParam "denominator",.skip,
    .block [.unchecked (.block instructions)]]) = _
  apply Inv32Revert.blockRevert
  have A := cleanParamExec (n+20) t c outside "x" x hx rfl (by dsimp [outside]; write_param)
  have B := cleanParamExec (n+20) t c outside "y" y hy rfl (by dsimp [outside]; write_param)
  have D := cleanParamExec (n+20) t c outside "denominator" d hd rfl (by dsimp [outside]; write_param)
  have sk : Stmt.eval (n+21) t c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
  exact (seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans ((seqStep _ _ _ _ _ _ _ D).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ blk))))
theorem call (n : Nat) (c : Context) (r : Runtime) (x y d : String) (targets : List String)
    (a b den : Nat) (ha : a<R) (hb : b<R) (hd : den<R) (pos : 0<den) (over : R≤a*b/den)
    (X : r.lookupLocal? x = some (.word a)) (Y : r.lookupLocal? y = some (.word b))
    (D : r.lookupLocal? d = some (.word den)) :
    ∃ next err, Stmt.eval (n+23) Inv32Dispatch.model.core.table c r (.internalCall targets Inv32Bodies.Floor.key [.var x,.var y,.var d]) =
      pure (.reverted next err) := by
  obtain ⟨fn,found,ps,rs,bd⟩ := Inv32FloorCall.sig
  let empty := {r with locals := []}
  have enter : internalCallEnter? fn [.word a,.word b,.word den] r = some (scope empty a b den,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Internal.wordBindings,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,scope,empty,Runtime.withFrame]
  obtain ⟨next,err,ev⟩ := body n {c with checked := true} empty a b den ha hb hd pos over
  rw [← bd] at ev
  exact ⟨next,err,Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32FloorCall.args _ _ _ _ _ _ _ _ X Y D) found enter ev⟩
end Inv32FloorOverflow
