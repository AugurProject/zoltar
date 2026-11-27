import Inv48WrapperArgsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify
namespace Inv48.WrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

/-- A semantic invariant for arbitrary successful finite for-loop executions.
No batch-length bound or concrete batch replay. Leaf obligations are explicit:
this theorem alone does not certify the actual operations validation body. -/
theorem forInvariant (t : FunctionTable) (c : Context) (cond : Expr) (post body : Stmt)
    (P : Runtime → Prop)
    (condition : ∀ r, P r → ∃ result,
      Expr.eval c r cond = pure result)
    (bodyFalls : ∀ n r, Inv48.WrapperTraversal.Falling (Stmt.eval n t c r body))
    (postFalls : ∀ n r, Inv48.WrapperTraversal.Falling (Stmt.eval n t c r post))
    (bodyPreserves : ∀ n r final tr, P r →
      Interaction.Executes (Stmt.eval n t c r body) tr (.ok (.normal final)) → P final)
    (postPreserves : ∀ n r final tr, P r →
      Interaction.Executes (Stmt.eval n t c r post) tr (.ok (.normal final)) → P final)
    (conditionPreserves : ∀ r v mid, P r → Expr.eval c r cond = pure (v,mid) → P mid)
    (n : Nat) (r final : Runtime) (trace : Interaction.Transcript) (start : P r)
    (run : Interaction.Executes (Stmt.evalFor n t c r cond post body) trace (.ok (.normal final))) :
    P final := by
  induction n generalizing r trace with
  | zero => rw [Stmt.evalFor] at run; cases run
  | succ n ih =>
    obtain ⟨⟨v,mid⟩,eq⟩ := condition r start
    rw [Stmt.evalFor,eq] at run
    have caught : (pure (v,mid) : SolI (Value × Runtime)).caught = pure (.ok (v,mid)) := rfl
    rw [caught,pb] at run
    dsimp only at run
    have pm := conditionPreserves r v mid start eq
    cases word : v.expectWord with
    | error err => simp only [word] at run; cases run
    | ok w =>
      simp only [word] at run
      split at run
      · obtain ⟨result,bt,rest,_,first,last⟩ := bindSuccess _ _ _ _ run
        have falls := bodyFalls n mid bt result first
        cases result with
        | normal q =>
          have pq := bodyPreserves n mid q bt pm first
          obtain ⟨result,pt,rest,_,posted,last⟩ := bindSuccess _ _ _ _ last
          have falls := postFalls n q pt result posted
          cases result with
          | normal q => exact ih q rest (postPreserves n _ q pt pq posted) last
          | reverted q err => cases last
          | _ => contradiction
        | reverted q err => cases last
        | _ => contradiction
      · cases run; exact pm
end Inv48.WrapperArgs
