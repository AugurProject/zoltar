import Inv48PreLoopJoinDecode
import Inv48BatchInputLoopScope
import Inv48GuardArgsFrameReadOnly
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PreLoopJoin
open Inv48.EscrowJoin Inv48.ReportingGuardFrame
set_option linter.unusedTactic false
set_option linter.unreachableTactic false
set_option linter.unnecessarySeqFocus false
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
inductive Read : Expr → Prop
  | timestamp : Read (.env .blockTimestamp)
  | immutable (name) : Read (.immutable name)
  | and {a b} : Read a → Read b → Read (.binary .boolAnd a b)
  | word (v) : Read (.word v)
  | var (name) : Read (.var name)
  | cast {e} (kind bits) : Read e → Read (.castOp kind bits e)
  | binary {a b} (op) (na : op ≠ .boolAnd) (no : op ≠ .boolOr) : Read a → Read b → Read (.binary op a b)
  | indexVar {b} (name) : Read b → Read (.index (.var name) b)
  | indexIndex {a b d} : Read (.index a b) → Read d → Read (.index (.index a b) d)
  | lengthVar (name) : Read (.length (.var name))
  | lengthIndex {a b} : Read (.index a b) → Read (.length (.index a b))
  | ternary {a b d} : Read a → Read b → Read d → Read (.ternary a b d)

private theorem pureFrozen (r : Runtime) (v : α) : Frozen r (pure (v,r)) := ⟨.ok v,rfl⟩
private theorem throwFrozen (r : Runtime) (e : SolidityFailure) :
    Frozen (α := α) r (throw e) := ⟨.error e,rfl⟩

-- All three evaluators share fuel. Resolution and list evaluation are included
-- so reference-root reads are proved from their actual semantics.
theorem readFuel (n : Nat) (c : Context) :
    (∀ e, Read e → ∀ r, Frozen r (Expr.evalFuel n c r e)) ∧
    (∀ e, Read e → ∀ r, Frozen r (Expr.resolveLValueFuel n c r e)) ∧
    (∀ es, List.Forall Read es → ∀ r, Frozen r (Expr.evalListFuel n c r es)) := by
  induction n with
  | zero => exact ⟨fun _ _ _ => ⟨.error (.revert .typeMismatch),rfl⟩,
      fun _ _ _ => ⟨.error (.revert .typeMismatch),rfl⟩,
      fun _ _ _ => ⟨.error (.revert .typeMismatch),rfl⟩⟩
  | succ n ih =>
    have ev (e) (h : Read e) (r) := ih.1 e h r
    have res (e) (h : Read e) (r) := ih.2.1 e h r
    have ls (es) (h : List.Forall Read es) (r) := ih.2.2 es h r
    constructor
    · intro e h r
      cases h <;> rw [Expr.evalFuel]
      all_goals
        repeat' first
          | solve | simp
          | exact pureFrozen r _
          | exact throwFrozen r _
          | assumption
          | exact ev _ (by first | assumption | constructor <;> assumption) r
          | apply frozenBind r _ _ (ev _ (by first | assumption | constructor <;> assumption) r); intro v; dsimp only
          | apply frozenBind r _ _ (res _ (by first | assumption | constructor <;> assumption) r); intro v; dsimp only
          | apply frozenBind r _ _ (res _ (by constructor <;> assumption) r); intro v; dsimp only
          | apply frozenBind r _ _ (ls _ (by repeat' first | assumption | constructor) r); intro v; dsimp only
          | apply frozenLift r _ _; intro v; dsimp only
          | split <;> try subst_vars <;> try dsimp only
    · constructor
      · intro e h r
        cases h <;> rw [Expr.resolveLValueFuel]
        all_goals
          repeat' first
            | solve | simp
            | exact pureFrozen r _
            | exact throwFrozen r _
            | exact res _ (by first | assumption | constructor <;> assumption) r
            | apply frozenBind r _ _ (ev _ (by first | assumption | constructor <;> assumption) r); intro v; dsimp only
            | apply frozenBind r _ _ (res _ (by first | assumption | constructor <;> assumption) r); intro v; dsimp only
            | apply frozenLift r _ _; intro v; dsimp only
            | split <;> try subst_vars <;> try dsimp only
      · intro es h r
        cases es with
        | nil => exact pureFrozen r _
        | cons e es =>
          rw [List.forall_cons] at h
          obtain ⟨head,tail⟩ := h
          rw [Expr.evalListFuel]
          apply frozenBind r _ _ (ev _ head r)
          intro v
          apply frozenBind r _ _ (ls _ tail r)
          intro vs
          exact pureFrozen r _
end Inv48.PreLoopJoin
namespace Inv48.PreLoopJoin
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.EscrowJoin Inv48.ReportingGuardFrame

theorem frozen (c : Context) (r : Runtime) (e : Expr) (safe : Read e) :
    Inv48.EscrowJoin.Frozen r (Expr.eval c r e) :=
  (readFuel (Expr.orderFuel e + 1) c).1 e safe r

/-- A successful real require with a read-only expression preserves the exact
runtime, including lazy references, rather than merely its scalar bindings. -/
theorem requireRuntime (n : Nat) (t : FunctionTable) (c : Context)
    (e : Expr) (reason : Option String) (safe : Read e)
    (r final : Runtime) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n t c r (.requireStmt e reason)) trace (.ok (.normal final))) :
    final = r := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    dsimp only at run
    obtain ⟨result,eq⟩ := frozen c r e safe
    cases result with
    | error err => rw [eq] at run; cases err <;> cases run
    | ok v =>
      have caught : (Expr.eval c r e).caught = pure (.ok (v,r)) := by rw [eq]; rfl
      rw [caught] at run
      have pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
      rw [pb] at run
      dsimp only at run
      cases value : v.expectWord with
      | error err => rw [value] at run; cases run
      | ok w =>
        rw [value] at run
        dsimp only at run
        split at run
        · have h := Inv48.EscrowPrefix.pureResult _ _ _ run
          cases h.2
          rfl
        · cases reason <;> (have h := Inv48.EscrowPrefix.pureResult _ _ _ run; cases h.2)
end Inv48.PreLoopJoin
