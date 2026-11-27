import Inv48PostLoopJoinCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PostLoopJoin
open Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem scalarForce (v : Value) (w : Nat) (h : v.asStorageWord? = some w) :
    v.forceAbiLazy = .ok v := by
  cases v <;> simp_all [Value.asStorageWord?,Value.forceAbiLazy]

/-- Checked uint32 cleanup and uint256 cleanup of the same read agree. -/
theorem cleanup32Wide (v : Value) (g : Nat)
    (h : uintCleanup? true 32 v = .ok (.word g)) :
    uintCleanup? true 256 v = .ok (.word g) := by
  unfold uintCleanup? at h ⊢
  cases forced : v.forceAbiLazy with
  | error err => simp [forced,Bind.bind,Except.bind] at h
  | ok value =>
    simp only [forced,Bind.bind,Except.bind] at h ⊢
    simp only [show (0 < 32 && 32 <= 256) = true from rfl,
      show (0 < 256 && 256 <= 256) = true from rfl,ite_true] at h ⊢
    cases storage : value.asStorageWord? with
    | none => simp [storage] at h
    | some w =>
      simp only [storage] at h ⊢
      have force := scalarForce value w storage
      have bound : SolidCore.Solidity.Shared.norm w < 2^32 := by
        by_contra bad
        have bad2 : 4294967296 ≤ SolidCore.Solidity.Shared.norm w := Nat.le_of_not_gt bad
        simp [bad2] at h
      have wide : SolidCore.Solidity.Shared.norm w < 2^256 := bound.trans_le (by decide)
      simp only [bound,wide,decide_true,Bool.not_true,Bool.true_and] at h ⊢
      simp only [uintCast?,force,Bind.bind,Except.bind,storage] at h ⊢
      simp only [show (0 < 32 && 32 <= 256) = true from rfl,
        show (0 < 256 && 256 <= 256) = true from rfl,ite_true,
        Nat.mod_eq_of_lt bound,Nat.mod_eq_of_lt wide] at h ⊢
      exact h

/-- Both actual reads share the same frozen field evaluation. No field-value
or batch-materialization premise is required. -/
theorem budgetGasAgree (c : Context) (r : Runtime) (supplied g : Nat)
    (checked : c.checked = true)
    (wide : Expr.evalFuel 7 c r (.castOp .uintCleanup 256 batchGas) = pure (.word supplied,r))
    (narrow : Expr.eval c r gasRead = pure (.word g,r)) : supplied = g := by
  obtain ⟨result,eq⟩ := Inv48.BatchReadFrame.frozen c r batchGas (.indexVar "batch" (.word 0))
  have small : Expr.evalFuel 6 c r batchGas = Expr.eval c r batchGas := by rfl
  have small2 : Expr.evalFuel 4 c r batchGas = Expr.eval c r batchGas := by rfl
  change Expr.evalFuel 5 c r (.castOp .uintCleanup 32 batchGas) = _ at narrow
  rw [Expr.evalFuel,small2,eq] at narrow
  rw [Expr.evalFuel,small,eq] at wide
  cases result with
  | error err => cases narrow
  | ok value =>
    change (pure (value,r) >>= _) = _ at narrow wide
    simp only [show ∀ (α β : Type) (a : α) (k : α → SolI β), pure a >>= k = k a from fun _ _ _ _ => rfl] at narrow wide
    have clean : uintCleanup? true 32 value = .ok (.word g) := by
      cases h : uintCleanup? c.checked 32 value with
      | error err => rw [h] at narrow; cases narrow
      | ok v => rw [h] at narrow; cases narrow; simpa [checked] using h
    rw [checked,cleanup32Wide value g clean] at wide
    cases wide
    rfl
end Inv48.PostLoopJoin
