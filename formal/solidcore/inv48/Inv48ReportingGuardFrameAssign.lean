import Inv48ReportingGuardFrameLocals
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ReportingGuardFrame
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem cp {α : Type} (a : α) : (pure a : SolI α).caught = pure (.ok a) := rfl

theorem assignVar (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (name source : String) (old : Nat)
    (bound : r.lookupLocal? name = some (.word old)) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+1) t c r (.assign (.var name) (.var source)))
      trace (.normal final)) :
    ∃ value, r.assignLocal? name value = some final := by
  have notMem : (LValue.var name).wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,bound]
  obtain ⟨value,eq⟩ := varFrozen c r source
  change Expr.eval c r (.var source) = _ at eq
  rw [Stmt.eval] at run
  dsimp only at run
  rw [notMem] at run
  simp only [Runtime.lookupMemoryRef?,bound,Bool.false_eq_true,if_false] at run
  cases value with
  | error err => rw [eq] at run; cases err <;> cases run
  | ok value =>
    change Expr.eval c r (.var source) = pure (value,r) at eq
    rw [eq] at run
    try simp only [cp,pb] at run
    rw [Inv32Writes.resolve c r name old bound] at run
    simp only [cp,pb,ResolvedLValue.write,ResolvedLValue.asStoragePath?,ite_self] at run
    split at run
    next updated write =>
      have h := pureResult _ _ _ run
      cases h.2
      cases assigned : r.assignLocal? name value with
      | none => simp only [assigned] at write; contradiction
      | some next =>
        simp only [assigned,Except.ok.injEq] at write
        cases write
        exact ⟨value,assigned⟩
    next bad => have h := pureResult _ _ _ run; cases h.2

/-- A scalar destination in the second scope changes only its own binding. -/
theorem assignSecond (r final : Runtime) (name : String) (old : Nat)
    (head : Frame) (tail : Frame) (rest : LocalEnv)
    (miss : head.lookup? name = none)
    (shape : r.locals = head::((name,.word old)::tail)::rest)
    (value : Value) (write : r.assignLocal? name value = some final) :
    ∃ updated, final.locals = head::((name,updated)::tail)::rest := by
  simp only [Runtime.assignLocal?,Runtime.lookupLocal?,shape,LocalEnv.lookup?,miss,
    Frame.lookup?,if_true] at write
  split at write
  next coerced eq =>
    have absent : head.assign? name coerced = none := by
      clear shape write
      induction head with
      | nil => rfl
      | cons pair xs ih =>
        rcases pair with ⟨key,v⟩
        simp only [Frame.lookup?] at miss
        split at miss
        · contradiction
        next ne => simp only [Frame.assign?,ne,if_false,ih miss]
    simp only [LocalEnv.assign?,absent,Frame.assign?,if_true] at write
    cases write
    exact ⟨_,rfl⟩
  next bad => contradiction

end Inv48.ReportingGuardFrame
