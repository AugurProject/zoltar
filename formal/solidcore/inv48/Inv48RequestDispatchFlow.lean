import Inv48RequestDispatchPublic
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards
namespace Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- Inversion of successful composition never presumes that either subprogram
succeeds in every environment. Failure outcomes cannot produce this run. -/
theorem bindSuccess {α β : Type} (first : SolI α) (next : α → SolI β)
    (trace : Interaction.Transcript) (out : β)
    (run : Interaction.Executes (first >>= next) trace (.ok out)) :
    ∃ value xs ys, trace = xs++ys ∧ Interaction.Executes first xs (.ok value) ∧
      Interaction.Executes (next value) ys (.ok out) := by
  rcases Interaction.Executes.bind_cases run with bad | good
  · obtain ⟨err,eq,_⟩ := bad
    cases eq
  · exact good

/-- The selected child is reached only if preceding siblings fall through.
An early returned/selfdestructed/etc. result is retained as a distinct branch,
including the successful completion of its actual outer continuation. -/
theorem blockInversion (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime)
    (xs : List Stmt) (child : Stmt) (ys : List Stmt)
    (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval (n+1) table c r (.block (xs++child::ys))) trace (.ok out)) :
    (∃ early before after, (∀ mid, early ≠ .normal mid) ∧ trace = before++after ∧
      Interaction.Executes (Stmt.evalList n table c r.pushScope xs) before (.ok early) ∧
      Interaction.Executes (pop early) after (.ok out)) ∨
    (∃ mid before after, trace = before++after ∧
      Interaction.Executes (Stmt.evalList n table c r.pushScope xs) before (.ok (.normal mid)) ∧
      Prefix (Stmt.eval (n+1) table c r (.block (xs++child::ys))) before
        ((Stmt.eval n table c mid child >>= listNext n table c ys) >>= pop) ∧
      Interaction.Executes ((Stmt.eval n table c mid child >>= listNext n table c ys) >>= pop)
        after (.ok out)) := by
  rw [blockSplit] at run
  obtain ⟨result,before,after,split,exec,tail⟩ := bindSuccess _ _ _ _ run
  cases result with
  | normal mid =>
    right
    refine ⟨mid,before,after,split,exec,?_,tail⟩
    rw [blockSplit]
    exact Prefix.ofExecution exec _
  | returned mid values => exact .inl ⟨.returned mid values,before,after,by intros; simp,split,exec,tail⟩
  | constructorReturned mid code => exact .inl ⟨.constructorReturned mid code,before,after,by intros; simp,split,exec,tail⟩
  | selfdestructed mid => exact .inl ⟨.selfdestructed mid,before,after,by intros; simp,split,exec,tail⟩
  | reverted mid err => exact .inl ⟨.reverted mid err,before,after,by intros; simp,split,exec,tail⟩
  | broke mid => exact .inl ⟨.broke mid,before,after,by intros; simp,split,exec,tail⟩
  | continued mid => exact .inl ⟨.continued mid,before,after,by intros; simp,split,exec,tail⟩

end Inv48.RequestDispatch
