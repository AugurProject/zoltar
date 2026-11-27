import Inv48GuardArgsFrameCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.GuardArgsFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

/-- Only the expression constructors occurring in the three plain guards. -/
inductive ReadOnly : Expr → Prop
  | word (v) : ReadOnly (.word v)
  | var (name) : ReadOnly (.var name)
  | value : ReadOnly .callValue
  | cleanup {e} (bits) : ReadOnly e → ReadOnly (.castOp .uintCleanup bits e)
  | binary {a b} (op) (nonAnd : op ≠ .boolAnd) (nonOr : op ≠ .boolOr) :
      ReadOnly a → ReadOnly b → ReadOnly (.binary op a b)

private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

private theorem frozenLift (r : Runtime) (result : Except RevertData Value) :
    Frozen r (do let v ← result; pure (v,r)) := by
  cases result with
  | ok v => exact ⟨.ok v,rfl⟩
  | error e => exact ⟨.error (.revert e),rfl⟩

theorem readOnlyFuel (e : Expr) (safe : ReadOnly e) (fuel : Nat)
    (c : Context) (r : Runtime) : Frozen r (Expr.evalFuel fuel c r e) := by
  induction fuel generalizing e r with
  | zero => exact ⟨.error (.revert .typeMismatch),rfl⟩
  | succ n ih =>
    cases safe with
    | word v => exact ⟨.ok (.word (normWord v)),rfl⟩
    | var name =>
      rw [Expr.evalFuel]
      cases storage : r.lookupStorageBase? name with
      | some base =>
        simp only [storage]
        cases loaded : r.loadStorageBasePath c base [] with
        | ok v => exact ⟨.ok v,rfl⟩
        | error e => exact ⟨.error (.revert e),rfl⟩
      | none =>
        simp only [storage]
        cases binding : r.lookupLocal? name with
        | none => exact ⟨.error (.revert .typeMismatch),rfl⟩
        | some v =>
          simp only [binding]
          cases loaded : r.derefMemoryValue v with
          | ok v => exact ⟨.ok v,rfl⟩
          | error e => exact ⟨.error (.revert e),rfl⟩
    | value => exact ⟨.ok (.word c.value),rfl⟩
    | @cleanup e bits safe =>
      rw [Expr.evalFuel]
      obtain ⟨first,eq⟩ := ih e safe r
      rw [eq]
      cases first with
      | error e => exact ⟨.error e,rfl⟩
      | ok v => exact frozenLift r (uintCleanup? c.checked bits v)
    | @binary a b op nonAnd nonOr sa sb =>
      rw [Expr.evalFuel] <;> try assumption
      obtain ⟨right,eq⟩ := ih b sb r
      rw [eq]
      cases right with
      | error e => exact ⟨.error e,rfl⟩
      | ok v =>
        obtain ⟨left,eq⟩ := ih a sa r
        change Frozen r (Expr.evalFuel n c r a >>= _)
        rw [eq]
        cases left with
        | error e => exact ⟨.error e,rfl⟩
        | ok w => exact frozenLift r (BinaryOp.apply c.checked op w v)

theorem requireFrame (n : Nat) (t : FunctionTable) (c : Context)
    (e : Expr) (reason : Option String) (safe : ReadOnly e) :
    StatementFrame (n+1) t c (.requireStmt e reason) := by
  intro r final trace run
  rw [Stmt.eval] at run
  dsimp only at run
  obtain ⟨result,eq⟩ := readOnlyFuel e safe (Expr.orderFuel e + 1) c r
  change Expr.eval c r e = _ at eq
  cases result with
  | error err => rw [eq] at run; cases err <;> cases run
  | ok v =>
    have caught : (Expr.eval c r e).caught = pure (.ok (v,r)) := by rw [eq]; rfl
    rw [caught] at run
    rw [pb] at run
    dsimp only at run
    cases value : v.expectWord with
    | error e => rw [value] at run; have h := pureResult _ _ _ run; cases h.2
    | ok w =>
      rw [value] at run
      dsimp only at run
      split at run
      · have h := pureResult _ _ _ run; cases h.2; rfl
      · cases reason <;> (have h := pureResult _ _ _ run; cases h.2)

end Inv48.GuardArgsFrame
