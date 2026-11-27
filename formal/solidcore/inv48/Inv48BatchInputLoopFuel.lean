import Inv48BatchInputLoopPost
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchInputLoop
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.RequestGuards Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

/-- Auxiliary fuel induction. Unlike the earlier forInvariant, it does not
assume that every guard evaluation succeeds. Its semantic leaf premises are
explicit; it is not a certificate of the generated validation body. -/
theorem whileSuccessful (t : FunctionTable) (c : Context) (cond : Expr)
    (body : Stmt) (P : Runtime → Prop)
    (condition : ∀ r tr result, P r →
      Interaction.Executes (Expr.eval c r cond).caught tr (.ok result) →
      ∀ value mid, result = .ok (value,mid) → P mid)
    (falls : ∀ n r, Inv48.WrapperTraversal.Falling (Stmt.eval n t c r body))
    (preserves : ∀ n r final tr, P r →
      Interaction.Executes (Stmt.eval n t c r body) tr (.ok (.normal final)) → P final)
    (n : Nat) (r final : Runtime) (trace : Interaction.Transcript) (start : P r)
    (run : Interaction.Executes (Stmt.evalWhile n t c r cond body) trace
      (.ok (.normal final))) : P final := by
  induction n generalizing r trace with
  | zero => rw [Stmt.evalWhile] at run; cases run
  | succ n ih =>
    rw [Stmt.evalWhile] at run
    obtain ⟨result,ct,rest,_,guard,last⟩ := bindSuccess _ _ _ _ run
    cases result with
    | error err => cases last
    | ok pair =>
      rcases pair with ⟨value,mid⟩
      have pm := condition r ct (.ok (value,mid)) start guard value mid rfl
      dsimp only at last
      cases word : value.expectWord with
      | error err => simp only [word] at last; cases last
      | ok w =>
        simp only [word] at last
        split at last
        · obtain ⟨result,bt,rest,_,first,last⟩ := bindSuccess _ _ _ _ last
          have fall := falls n mid bt result first
          cases result with
          | normal next => exact ih next rest (preserves n mid next bt pm first) last
          | reverted next err => cases last
          | _ => contradiction
        · cases last; exact pm

end Inv48.BatchInputLoop
