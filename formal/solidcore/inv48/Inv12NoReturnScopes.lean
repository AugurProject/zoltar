import Inv12NoReturn
open SolidCore.Solidity.Source
namespace Inv12

theorem scopedNoReturn (rows : ScriptedResponder) (step : SolI Result) (map : Runtime → Runtime) (h : NoReturn rows step) :
    NoReturn rows (step >>= fun result => pure (result.mapRuntime map)) := by
  intro r vs eqn
  rw [runWithBind] at eqn
  cases val : step.runWith rows with
  | error _ => rw [val] at eqn;cases eqn
  | ok status =>
    rw [val] at eqn
    cases status <;> first | exact h _ _ val | cases eqn

theorem listNoReturn (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (stmts : List Stmt) (safe : ∀ stmt ∈ stmts, ∀ rt, NoReturn rows (Stmt.eval n t c rt stmt)) :
    NoReturn rows (Stmt.evalList n t c r stmts) := by
  induction stmts generalizing r with
  | nil => rw [Stmt.evalList];apply normalNoReturn
  | cons s rest ih =>
    intro final vs eqn
    rw [Stmt.evalList,runWithBind] at eqn
    cases hit : (Stmt.eval n t c r s).runWith rows with
    | error _ => rw [hit] at eqn;cases eqn
    | ok status =>
      rw [hit] at eqn
      cases status with
      | normal next => exact ih next (fun stmt h => safe stmt (List.mem_cons_of_mem _ h)) final vs eqn
      | returned next words => exact safe s (by simp) r next words hit
      | _ => cases eqn

theorem blockNoReturn (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (stmts : List Stmt) (safe : ∀ stmt ∈ stmts, ∀ rt, NoReturn rows (Stmt.eval n t c rt stmt)) :
    NoReturn rows (Stmt.eval (n+1) t c r (.block stmts)) := by
  rw [Stmt.eval];dsimp only
  exact scopedNoReturn _ _ _ (listNoReturn _ _ _ _ _ _ safe)
end Inv12
