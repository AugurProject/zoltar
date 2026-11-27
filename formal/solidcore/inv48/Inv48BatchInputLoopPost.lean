import Inv48BatchInputLoopCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchInputLoop
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem incWrite (c : Context) (r final : Runtime) (old : Nat) (out : Value)
    (bound : r.lookupLocal? "index" = some (.word old))
    (success : ResolvedLValue.applyIncDecCleanup c r (.local "index") .add true
      (.uint 256) = .ok (out,final)) :
    ∃ value, r.assignLocal? "index" value = some final := by
  simp only [ResolvedLValue.applyIncDecCleanup,ResolvedLValue.read,ResolvedLValue.readRaw,bound] at success
  change (do
    let next ← BinaryOp.apply c.checked .add (.word old) (.word 1)
    let value ← ValueCleanup.apply c.checked (.uint 256) next
    let updated ← ResolvedLValue.write c r (.local "index") value
    pure (Value.word old,updated)) = .ok (out,final) at success
  cases add : BinaryOp.apply c.checked .add (.word old) (.word 1) with
  | error err => simp [add,Bind.bind,Except.bind] at success
  | ok next =>
    simp only [add,Bind.bind,Except.bind] at success
    cases clean : ValueCleanup.apply c.checked (.uint 256) next with
    | error err => simp [clean] at success
    | ok value =>
      simp only [clean,ResolvedLValue.write] at success
      cases assigned : r.assignLocal? "index" value with
      | none => simp [assigned] at success
      | some updated =>
        simp only [assigned] at success
        change Except.ok (Value.word old,updated) = Except.ok (out,final) at success
        cases success
        exact ⟨value,assigned⟩

/-- The actual generated postfix step, inverted from successful execution.
Neither increment arithmetic success nor a per-step frame is a premise. -/
theorem actualPostInputs (n : Nat) (c : Context) (r final : Runtime)
    (p a b old : Nat) (batch : Value) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "index" = some (.word old))
    (inputs : Inputs r p a b batch)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopPost) trace (.ok (.normal final))) :
    Inputs final p a b batch := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    have base : r.lookupStorageBase? "index" = none := by
      simp [Runtime.lookupStorageBase?,bound]
    have resolve : Expr.resolveLValue c r (.var "index") = pure (.local "index",r) := by
      simp [Expr.resolveLValue,Expr.resolveLValueFuel,base,bound]
    have expression : Expr.eval c r
        (.incDec .add true (some (.uint 256)) (.var "index")) =
        (liftM (ResolvedLValue.applyIncDecCleanup c r (.local "index") .add true
              (.uint 256)) : SolI (Value × Runtime)) := by
      unfold Expr.eval
      rw [Expr.evalFuel]
      change (Expr.resolveLValue c r (.var "index") >>= _) = _
      rw [resolve,pb]
    change Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.exprStmt (.incDec .add true (some (.uint 256)) (.var "index")))) trace
      (.ok (.normal final)) at run
    rw [Stmt.eval] at run
    dsimp only at run
    rw [expression] at run
    cases result : ResolvedLValue.applyIncDecCleanup c r (.local "index") .add true
        (.uint 256) with
    | error err => simp only [result] at run; cases run
    | ok pair =>
      rcases pair with ⟨value,updated⟩
      simp only [result] at run
      have eq := pureResult _ _ _ run
      cases eq.2
      obtain ⟨v,write⟩ := incWrite c r final old value bound result
      exact writeInputs r final p a b old batch v "index" (Or.inl rfl) bound write inputs
end Inv48.BatchInputLoop
