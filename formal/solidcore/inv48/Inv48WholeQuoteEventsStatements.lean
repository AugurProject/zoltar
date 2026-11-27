import Inv48WholeQuoteEventsExpressions
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WholeQuoteEvents
set_option maxRecDepth 65536
set_option linter.unnecessarySeqFocus false
set_option maxHeartbeats 200000

theorem resolveQuiet (c : Context) (r : Runtime) (name : String) :
    Quiet (LValue.resolveWithRuntime (.var name) c r) := resolveVarQuiet _ _ _ _

macro "quiet_stmt" : tactic => `(tactic|
  repeat' first
    | contradiction
    | with_reducible exact quietPure _
    | with_reducible exact quietThrow _
    | with_reducible exact quietExcept _
    | (with_reducible apply quietBind; · exact evalQuiet _ _ _ (by first | assumption | tauto | (simp only [exprSafe,Bool.and_eq_true] at * <;> tauto)))
    | (with_reducible apply quietBind; · exact memoryEvalQuiet _ _ _ (by first | assumption | tauto | (simp only [exprSafe,Bool.and_eq_true] at * <;> tauto)))
    | (with_reducible apply quietBind; · exact quietCaught _ (evalQuiet _ _ _ (by first | assumption | tauto | (simp only [exprSafe,Bool.and_eq_true] at * <;> tauto))))
    | (with_reducible apply quietBind; · exact quietCaught _ (memoryEvalQuiet _ _ _ (by first | assumption | tauto | (simp only [exprSafe,Bool.and_eq_true] at * <;> tauto))))
    | (with_reducible apply quietBind; · exact quietCaught _ (resolveQuiet _ _ _))
    | (with_reducible apply quietBind; · apply quietCaught; apply_assumption)
    | (with_reducible apply quietBind; · assumption)
    | (with_reducible apply quietBind; · exact quietCaught _ (resolveQuiet _ _ _))
    | (with_reducible apply quietBind; · with_reducible exact quietExcept _)
    | (rintro ⟨x,y⟩; dsimp only)
    | (intro x; try dsimp only)
    | (split <;> try dsimp only))

theorem assignQuiet (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (name : String) (e : Source.Expr) (safe : exprSafe e = true) :
    Quiet (Stmt.eval (n+1) t c r (.assign (.var name) e)) := by
  have resolve : ∀ rt, Quiet (LValue.resolveWithRuntime (.var name) c rt) := by
    intro rt
    exact resolveVarQuiet _ _ _ _
  cases e <;> try simp only [exprSafe,Bool.and_eq_true] at safe <;> try contradiction
  all_goals rw [Stmt.eval]
  all_goals dsimp only
  all_goals quiet_stmt

theorem assignIndexQuiet (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (name : String) (i : Nat) (e : Source.Expr) (safe : exprSafe e = true) :
    Quiet (Stmt.eval (n+1) t c r (.assign (.index (.var name) (.word i)) e)) := by
  have resolve : ∀ rt, Quiet (LValue.resolveWithRuntime (.index (.var name) (.word i)) c rt) := by
    intro rt
    exact resolveIndexQuiet _ _ _ _ _
  rw [Stmt.eval]
  dsimp only
  quiet_stmt

theorem finishQuiet (fn : InternalFunction) (targets : List String) (saved : LocalEnv) (v : Result) :
    Quiet (internalCallFinish fn targets saved v) := by
  cases v <;> simp only [internalCallFinish]
  all_goals repeat' first | with_reducible exact quietPure _ | (unfold internalCallAssign) | split
end Inv48.WholeQuoteEvents
