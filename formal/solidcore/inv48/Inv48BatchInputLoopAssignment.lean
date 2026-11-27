import Inv48BatchInputLoopFuel
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchInputLoop
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

private theorem ipb {α β : Type} (a : α) (k : α → SolI β) :
    Interaction.bind (pure a) k = k a := rfl

private theorem liftOk {α : Type} (a : α) :
    (liftM (Except.ok a : Except RevertData α) : SolI α) = pure a := rfl

def bodyRhs : Expr :=
  match Inv48.OperationsWrapperArgs.loopIteration with
  | .block [_,_,.exprStmt (.assignment _ _ _ rhs)] => rhs
  | _ => .word 0

def gasUpdate (c : Context) (r : Runtime) (rhs : Value) : Except RevertData (Value × Runtime) := do
  let old ← ResolvedLValue.read c r (.local "requiredGas")
  let next ← BinaryOp.apply c.checked .add old rhs
  let value ← ValueCleanup.apply c.checked (.uint 256) next
  let final ← ResolvedLValue.write c r (.local "requiredGas") value
  pure (value,final)

theorem actualAssignmentShape :
    ∃ first second, Inv48.OperationsWrapperArgs.loopIteration =
      .block [first,second,.exprStmt (.assignment (some .add) (some (.uint 256))
        (.var "requiredGas") bodyRhs)] := by
  exact ⟨_,_,rfl⟩

theorem gasWrite (c : Context) (r final : Runtime) (old : Nat) (rhs out : Value)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (success : gasUpdate c r rhs = .ok (out,final)) :
    ∃ value, r.assignLocal? "requiredGas" value = some final := by
  simp only [gasUpdate,ResolvedLValue.read,ResolvedLValue.readRaw,bound] at success
  change (do
    let next ← BinaryOp.apply c.checked .add (.word old) rhs
    let value ← ValueCleanup.apply c.checked (.uint 256) next
    let final ← ResolvedLValue.write c r (.local "requiredGas") value
    pure (value,final)) = .ok (out,final) at success
  cases add : BinaryOp.apply c.checked .add (.word old) rhs with
  | error err => simp [add,Bind.bind,Except.bind] at success
  | ok next =>
    simp only [add,Bind.bind,Except.bind] at success
    cases clean : ValueCleanup.apply c.checked (.uint 256) next with
    | error err => simp [clean] at success
    | ok value =>
      simp only [clean,ResolvedLValue.write] at success
      cases assigned : r.assignLocal? "requiredGas" value with
      | none => simp [assigned] at success
      | some updated =>
        simp only [assigned] at success
        change Except.ok (value,updated) = Except.ok (out,final) at success
        cases success
        exact ⟨out,assigned⟩

/-- The RHS read-only premise is a remaining expression-level obligation,
not an assumed per-iteration frame. Arithmetic/write success is derived from
execution of the generated compound assignment. -/
theorem actualAssignmentInputs (n : Nat) (c : Context) (r final : Runtime)
    (p a b old : Nat) (batch : Value) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (inputs : Inputs r p a b batch)
    (rhsFrozen : Frozen r (Expr.eval c r bodyRhs))
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      (.exprStmt (.assignment (some .add) (some (.uint 256)) (.var "requiredGas") bodyRhs)))
      trace (.ok (.normal final))) : Inputs final p a b batch := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    have base : r.lookupStorageBase? "requiredGas" = none := by
      simp [Runtime.lookupStorageBase?,bound]
    have resolve : Expr.resolveLValue c r (.var "requiredGas") = pure (.local "requiredGas",r) := by
      simp [Expr.resolveLValue,Expr.resolveLValueFuel,base,bound]
    obtain ⟨rhs,eq⟩ := rhsFrozen
    cases rhs with
    | error err =>
      have expression : Expr.eval c r (.assignment (some .add) (some (.uint 256))
          (.var "requiredGas") bodyRhs) = throw err := by
        unfold Expr.eval
        rw [Expr.evalFuel]
        change (Expr.eval c r bodyRhs >>= _) = _
        rw [eq]
        rfl
      rw [Stmt.eval] at run
      dsimp only at run
      rw [expression] at run
      cases err <;> cases run
    | ok rhs =>
      change Expr.eval c r bodyRhs = pure (rhs,r) at eq
      have expression : Expr.eval c r (.assignment (some .add) (some (.uint 256))
          (.var "requiredGas") bodyRhs) =
          (liftM (gasUpdate c r rhs) : SolI (Value × Runtime)) := by
        unfold Expr.eval
        rw [Expr.evalFuel]
        change (Expr.eval c r bodyRhs >>= _) = _
        rw [eq,pb]
        change (Expr.resolveLValue c r (.var "requiredGas") >>= _) = _
        rw [resolve,pb]
        cases read : ResolvedLValue.read c r (.local "requiredGas") with
        | error err => simp [gasUpdate,read,Bind.bind,Except.bind]; rfl
        | ok lhs =>
          cases add : BinaryOp.apply c.checked .add lhs rhs with
          | error err => simp [liftOk,ipb,gasUpdate,read,add,Bind.bind,Except.bind]; rfl
          | ok next =>
            cases clean : ValueCleanup.apply c.checked (.uint 256) next with
            | error err => simp [liftOk,ipb,gasUpdate,read,add,clean,Bind.bind,Except.bind]; rfl
            | ok value =>
              cases write : ResolvedLValue.write c r (.local "requiredGas") value <;>
                simp [liftOk,ipb,gasUpdate,read,add,clean,write,Bind.bind,Except.bind] <;> rfl
      rw [Stmt.eval] at run
      dsimp only at run
      rw [expression] at run
      cases result : gasUpdate c r rhs with
      | error err => simp only [result] at run; cases run
      | ok pair =>
        rcases pair with ⟨value,updated⟩
        simp only [result] at run
        have eq := pureResult _ _ _ run
        cases eq.2
        obtain ⟨v,write⟩ := gasWrite c r final old rhs value bound result
        exact writeInputs r final p a b old batch v "requiredGas" (Or.inr rfl) bound write inputs
end Inv48.BatchInputLoop
