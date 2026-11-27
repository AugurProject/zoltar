import Inv48LiquidationGuardRecovery
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
def Frozen {α : Type} (r : Runtime) (tree : SolI (α × Runtime)) : Prop :=
  ∃ result : Except SolidityFailure α,
    tree = .done (result.map (fun value => (value,r)))
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


theorem requirePassage (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (e : Expr) (reason : Option String) (safe : ReadOnly e)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+1) t c r (.requireStmt e reason))
      trace (.ok (.normal final))) :
    trace = [] ∧ final = r ∧ ∃ v w,
      Expr.eval c r e = pure (v,r) ∧ v.expectWord = .ok w ∧ wordTruthy w = true := by
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
    | error err => rw [value] at run; cases run
    | ok w =>
      rw [value] at run
      dsimp only at run
      split at run
      · rename_i truth
        cases run
        exact ⟨rfl,rfl,v,w,eq,value,truth⟩
      · cases reason <;> cases run
end GuardRecovery
