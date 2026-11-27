import Inv32OverflowBody
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32FloorStart Inv32OverflowBody Inv32WideEntry
namespace Inv32FloorRejection
theorem raiseExecAt (table : FunctionTable) (links : Inv32Rejection.Links table) (n : Nat) (c : Context) (r : Runtime) (v : Nat) (hv : v<R) :
    ∃ next err, Stmt.eval (n+6) table c (saved r v) raise = pure (.reverted next err) := by
  let t := table
  let entry := (saved r v).pushScope
  let withArg := entry.declareLocal a (.word v)
  have A := Inv32Temps.temp (n+4) t c entry a reason v hv rfl
  obtain ⟨next,err,ev⟩ := Inv32PanicCall.callAt table links n c withArg a [] v hv rfl
  have cap := Inv32Revert.capture _ _ _ _ _ _ [] _ ev
  exact ⟨next.popScope,err,Inv32Revert.blockRevert _ _ _ _ _ _ _
    ((seqStep _ _ _ _ _ _ _ A).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ cap))⟩
theorem overflowBodyAt (table : FunctionTable) (links : Inv32Rejection.Links table) (n : Nat) (c : Context) (r : Runtime) (d : Nat) (hd : d<R)
    (D : locals r "denominator" = some d) :
    ∃ next err, Stmt.eval (n+17) table c r failureBranch = pure (.reverted next err) := by
  have Z := zero (n+15) table c r.pushScope reason
  have B := Inv32OverflowBody.chooseExecAt table links n c r d hd D
  have hv : Inv32PanicChoice.value (flag d)<R := by cases flag d <;> decide
  obtain ⟨next,err,E⟩ := raiseExecAt table links (n+10) c r _ hv
  rw [shape]; refine ⟨next.popScope,err,Inv32Revert.blockRevert _ _ _ _ _ _ _ ?_⟩
  exact (seqStep _ _ _ _ _ _ _ Z).trans ((seqStep _ _ _ _ _ _ _ B).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ E))
theorem overflowTakenAt (table : FunctionTable) (links : Inv32Rejection.Links table) (n : Nat) (c : Context) (r : Runtime) (d h : Nat) (hd : d<R) (hh : h<R)
    (le : d≤h) (u : c.checked=false) (D : locals r "denominator" = some d) (H : locals r "high" = some h) :
    ∃ next err, Stmt.eval (n+18) table c r overflow = pure (.reverted next err) := by
  have dd := Inv32ProductValues.cleanup (Inv32Scalar.localWord "denominator") false (locals r) d hd D
  have hi := Inv32ProductValues.cleanup (Inv32Scalar.localWord "high") false (locals r) h hh H
  have cond : overflowTest.run c.checked (locals r) = some 1 := by
    rw [u]; simp [overflowTest,Inv32WideGuards.leF,Inv32Scalar.binary,dd,hi,Inv32WideGuards.leWord _ _ hd hh,le,Inv32Scalar.projectWord]
  have val := evalFormula _ c r _ (by decide : overflowTest.depth ≤ overflowTest.core.orderFuel+1) cond
  unfold overflow
  rw [Inv32Blocks.branch _ _ _ _ _ _ _ true val,if_pos (by decide)]
  exact overflowBodyAt table links _ _ _ _ hd D

abbrev raiseExec := raiseExecAt Inv32Dispatch.model.core.table Inv32Rejection.trading
abbrev overflowBody := overflowBodyAt Inv32Dispatch.model.core.table Inv32Rejection.trading
abbrev overflowTaken := overflowTakenAt Inv32Dispatch.model.core.table Inv32Rejection.trading
end Inv32FloorRejection
