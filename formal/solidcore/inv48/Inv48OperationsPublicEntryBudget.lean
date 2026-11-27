import Inv48OperationsPublicEntryLimit
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem cleanupFuel (n : Nat) (c : Context) (r : Runtime) (e : Expr)
    (read : Inv48.BatchReadFrame.Read e) (bits : Nat) (positive : 0 < bits) (width : bits ≤ 256) :
    ∃ result : Except SolidityFailure Value, Expr.evalFuel (n+1) c r (.castOp .uintCleanup bits e) =
        Interaction.done (result.map fun v => (v,r)) ∧
      ∀ v, result = .ok v → ∃ g, v = .word g ∧ g < 2^bits := by
  obtain ⟨result,eq⟩ := (Inv48.BatchReadFrame.readFuel n c).1 e read r
  rw [Expr.evalFuel]
  rw [eq]
  cases result with
  | error err => exact ⟨.error err,rfl,by intro v h; cases h⟩
  | ok value =>
    cases clean : uintCleanup? c.checked bits value with
    | error err => exact ⟨.error (.revert err),by
        change (pure (value,r) >>= _) = _
        rw [pb]
        dsimp only
        rw [clean]
        rfl,by intro v h; cases h⟩
    | ok value2 =>
      refine ⟨.ok value2,?_,?_⟩
      · change (pure (value,r) >>= _) = _
        rw [pb]
        dsimp only
        rw [clean]
        rfl
      · intro v h
        cases h
        exact cleanupBound c.checked bits value value2 positive width clean

/-- Both actual budget operands and their numeric comparison are recovered
from the successful guard. No requiredGas/batch lookup or read-result premise
is supplied. The evaluator fuel is the actual common binary-operand fuel. -/
theorem budgetSatisfied (n : Nat) (c : Context) (r final : Runtime)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r budgetGuard)
      trace (.ok (.normal final))) :
    ∃ needed supplied,
      Expr.evalFuel 7 c r (.castOp .uintCleanup 256 (.var "requiredGas")) = pure (.word needed,r) ∧
      Expr.evalFuel 7 c r (.castOp .uintCleanup 256 batchGas) = pure (.word supplied,r) ∧
      needed < 2^256 ∧ supplied < 2^256 ∧ needed ≤ supplied ∧ final = r := by
  obtain ⟨v,w,condition,word,nonzero,same⟩ := budgetExecution n c r final trace run
  obtain ⟨left,L,LS⟩ := cleanupFuel 6 c r (.var "requiredGas") (.var _) 256 (by decide) (by decide)
  obtain ⟨right,R,RS⟩ := cleanupFuel 6 c r batchGas (.indexVar "batch" (.word 0)) 256 (by decide) (by decide)
  change Expr.evalFuel 8 c r (.binary .le (.castOp .uintCleanup 256 (.var "requiredGas"))
    (.castOp .uintCleanup 256 batchGas)) = pure (v,r) at condition
  rw [Expr.evalFuel] at condition <;> try {intro h; cases h}
  cases right with
  | error err => rw [R] at condition; cases condition
  | ok rv =>
    obtain ⟨supplied,rfl,hs⟩ := RS rv rfl
    change Expr.evalFuel 7 c r (.castOp .uintCleanup 256 batchGas) = pure (.word supplied,r) at R
    rw [R,pb] at condition
    dsimp only at condition
    cases left with
    | error err => rw [L] at condition; cases condition
    | ok lv =>
      obtain ⟨needed,rfl,hn⟩ := LS lv rfl
      change Expr.evalFuel 7 c r (.castOp .uintCleanup 256 (.var "requiredGas")) = pure (.word needed,r) at L
      rw [L,pb] at condition
      dsimp only at condition
      rw [pb] at condition
      dsimp only at condition
      have le : needed ≤ supplied := by
        by_contra bad
        have lt : supplied < needed := Nat.lt_of_not_ge bad
        have failed := leFailure c.checked needed supplied hn hs lt
        rw [failed] at condition
        have veq : v = .word 0 := by cases condition; rfl
        subst v
        have zero : w = 0 := by simpa [Value.expectWord,Value.expectWordRaw] using word.symm
        exact nonzero zero
      exact ⟨needed,supplied,L,R,hn,hs,le,same⟩
end Inv48.OperationsPublicEntry
