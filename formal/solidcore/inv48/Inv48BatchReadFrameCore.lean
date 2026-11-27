import Inv48BatchInputLoopScope
import Inv48GuardArgsFrameReadOnly
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchReadFrame
open Inv48.EscrowJoin Inv48.ReportingGuardFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
inductive Read : Expr → Prop
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
end Inv48.BatchReadFrame
