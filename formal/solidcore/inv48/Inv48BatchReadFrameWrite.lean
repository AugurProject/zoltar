import Inv48BatchReadFrameActual
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchReadFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.BatchInputLoop
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem ipb {α β : Type} (a : α) (k : α → SolI β) : Interaction.bind (pure a) k = k a := rfl
private theorem liftOk {α : Type} (a : α) : (liftM (Except.ok a : Except RevertData α) : SolI α) = pure a := rfl
theorem assignmentWrite (n : Nat) (c : Context) (r final : Runtime)
    (old : Nat) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      (.exprStmt (.assignment (some .add) (some (.uint 256)) (.var "requiredGas") bodyRhs)))
      trace (.ok (.normal final))) : ∃ value, r.assignLocal? "requiredGas" value = some final := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    have base : r.lookupStorageBase? "requiredGas" = none := by
      simp [Runtime.lookupStorageBase?,bound]
    have resolve : Expr.resolveLValue c r (.var "requiredGas") = pure (.local "requiredGas",r) := by
      simp [Expr.resolveLValue,Expr.resolveLValueFuel,base,bound]
    obtain ⟨rhs,eq⟩ := rhsFrozen c r
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
        exact gasWrite c r final old rhs value bound result
end Inv48.BatchReadFrame
