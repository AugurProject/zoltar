import Inv48BatchLoopClosureWrites
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchLoopClosure
open Inv48.BatchInputLoop Inv48.BatchReadFrame Inv48.EscrowJoin Inv48.EscrowPrefix
open Inv48.RequestGuards Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem envDropLookup (f g : LocalEnv) (name other : String) (v : Value)
    (different : other ≠ name) (h : f.assign? name v = some g) (k : Nat) :
    LocalEnv.lookup? (g.drop k) other = LocalEnv.lookup? (f.drop k) other := by
  induction f generalizing g k with
  | nil => simp [LocalEnv.assign?] at h
  | cons head tail ih =>
    cases k with
    | zero => exact envLookup _ _ _ _ _ different h
    | succ k =>
      simp only [LocalEnv.assign?] at h
      cases a : head.assign? name v with
      | some updated => simp only [a,Option.some.injEq] at h; cases h; rfl
      | none =>
        cases b : LocalEnv.assign? tail name v with
        | none => simp [a,b] at h
        | some updated =>
          simp only [a,b,Option.some.injEq] at h
          cases h
          exact ih updated b k

def DeepInputs (r : Runtime) (p a b : Nat) (batch : Value) : Prop :=
  ∀ k, k ≤ 2 → Inputs {r with locals := r.locals.drop k} p a b batch

theorem writeDeep (r final : Runtime) (p a b old : Nat) (batch value : Value)
    (name : String) (allowed : name = "index" ∨ name = "requiredGas")
    (bound : r.lookupLocal? name = some (.word old))
    (write : r.assignLocal? name value = some final) (inputs : DeepInputs r p a b batch) :
    DeepInputs final p a b batch := by
  simp only [Runtime.assignLocal?,bound] at write
  cases coerce : (Value.word old).coerceLike? value with
  | none => simp [coerce] at write
  | some v =>
    simp only [coerce] at write
    cases assigned : r.locals.assign? name v with
    | none => simp [assigned] at write
    | some locals =>
      simp only [assigned,Option.some.injEq] at write
      cases write
      intro k hk
      have keep (other : String) (different : other ≠ name) :=
        envDropLookup r.locals locals name other v different assigned k
      have start := inputs k hk
      rcases allowed with rfl | rfl <;>
        simpa only [Inputs,Runtime.lookupLocal?,keep "proposedRepPerEthPrice" (by decide),
          keep "requestedInitialAttoWeth" (by decide),keep "bountyAttoEth" (by decide),
          keep "batch" (by decide)] using start

def Invariant (r : Runtime) (p a b : Nat) (batch : Value) : Prop :=
  DeepInputs r p a b batch ∧
  (∃ i, r.lookupLocal? "index" = some (.word i)) ∧
  (∃ g, r.lookupLocal? "requiredGas" = some (.word g))

theorem iterationInvariant (n : Nat) (c : Context) (r final : Runtime)
    (p a b : Nat) (batch : Value) (trace : Interaction.Transcript)
    (start : Invariant r p a b batch)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopIteration) trace (.ok (.normal final))) :
    Invariant final p a b batch := by
  rcases start with ⟨inputs,⟨i,hi⟩,⟨g,hg⟩⟩
  obtain ⟨w,write⟩ := iterationWrite n c r final g trace hg run
  exact ⟨writeDeep r final p a b g batch (.word w) "requiredGas" (Or.inr rfl) hg write inputs,
    ⟨i,(scalarWrite r final "requiredGas" "index" g (.word w) hg (by decide) write).trans hi⟩,
    ⟨w,wordAssigned r final "requiredGas" g w hg write⟩⟩

theorem postInvariant (n : Nat) (c : Context) (r final : Runtime)
    (p a b : Nat) (batch : Value) (trace : Interaction.Transcript)
    (start : Invariant r p a b batch)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopPost) trace (.ok (.normal final))) :
    Invariant final p a b batch := by
  rcases start with ⟨inputs,⟨i,hi⟩,⟨g,hg⟩⟩
  obtain ⟨w,write⟩ := postWrite n c r final i trace hi run
  exact ⟨writeDeep r final p a b i batch (.word w) "index" (Or.inl rfl) hi write inputs,
    ⟨w,wordAssigned r final "index" i w hi write⟩,
    ⟨g,(scalarWrite r final "index" "requiredGas" i (.word w) hi (by decide) write).trans hg⟩⟩

/-- Induction follows actual interpreter fuel. Error guards are allowed; the
successful transcript rules them out. No per-iteration semantic premises. -/
theorem forSuccessful (n : Nat) (c : Context) (r final : Runtime)
    (p a b : Nat) (batch : Value) (trace : Interaction.Transcript)
    (start : Invariant r p a b batch)
    (run : Interaction.Executes (Stmt.evalFor n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopCondition Inv48.OperationsWrapperArgs.loopPost
      Inv48.OperationsWrapperArgs.loopIteration) trace (.ok (.normal final))) :
    Invariant final p a b batch := by
  induction n generalizing r trace with
  | zero => rw [Stmt.evalFor] at run; cases run
  | succ n ih =>
    obtain ⟨result,eq⟩ := conditionFrozen c r
    cases result with
    | error err =>
      rw [Stmt.evalFor,eq] at run
      cases err <;> cases run
    | ok value =>
      change Expr.eval c r Inv48.OperationsWrapperArgs.loopCondition = pure (value,r) at eq
      rw [Stmt.evalFor,eq] at run
      have caught : (pure (value,r) : SolI (Value × Runtime)).caught = pure (.ok (value,r)) := rfl
      rw [caught,pb] at run
      dsimp only at run
      cases word : value.expectWord with
      | error err => simp only [word] at run; cases run
      | ok w =>
        simp only [word] at run
        split at run
        · obtain ⟨result,bt,rest,_,first,last⟩ := bindSuccess _ _ _ _ run
          have falls := Inv48.OperationsWrapperArgs.iterationFalls n c r bt result first
          cases result with
          | normal q =>
            have pq := iterationInvariant n c r q p a b batch bt start first
            obtain ⟨result,pt,rest,_,posted,last⟩ := bindSuccess _ _ _ _ last
            have falls := Inv48.OperationsWrapperArgs.postFalls n c q pt result posted
            cases result with
            | normal next => exact ih next rest (postInvariant n c q next p a b batch pt pq posted) last
            | reverted q err => cases last
            | _ => contradiction
          | reverted q err => cases last
          | _ => contradiction
        · cases run; exact start
end Inv48.BatchLoopClosure
