import Inv12PublicScopes
open SolidCore.Solidity.Source
namespace Inv12

def NoReturn (rows : ScriptedResponder) (tree : SolI Result) :=
  ∀ r vs, tree.runWith rows≠.ok (.returned r vs)

theorem bindNoReturn {α : Type} (rows : ScriptedResponder) (a : SolI α) (f : α → SolI Result)
    (h : ∀ x, NoReturn rows (f x)) : NoReturn rows (a >>= f) := by
  intro r vs ret; rw [runWithBind] at ret
  cases E : a.runWith rows with
  | error err => rw [E] at ret;cases ret
  | ok x => rw [E] at ret;exact h x r vs ret

theorem normalNoReturn (rows : ScriptedResponder) (r : Runtime) : NoReturn rows (pure (.normal r)) := by
  intro _ _ h; cases h
theorem revertNoReturn (rows : ScriptedResponder) (r : Runtime) (e : RevertData) : NoReturn rows (pure (.reverted r e)) := by
  intro _ _ h; cases h

theorem captureCannotReturn (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (names : List String) (stmt : Stmt) : NoReturn rows (Stmt.eval (n+1) t c r (.captureReturn names stmt)) := by
  rw [Stmt.eval]; dsimp only
  apply bindNoReturn
  intro status
  cases status <;> dsimp only
  all_goals repeat' first | apply normalNoReturn | apply revertNoReturn | split | (intro _ _ h; cases h)

theorem internalAssignNoReturn (r : Runtime) (targets : List String) (vs : List Value) (rows : ScriptedResponder) :
    NoReturn rows (internalCallAssign r targets vs) := by
  unfold internalCallAssign
  split
  · apply normalNoReturn
  · split <;> first | apply normalNoReturn | apply revertNoReturn

theorem internalFinishNoReturn (fn : InternalFunction) (targets : List String) (locals : LocalEnv)
    (status : Result) (rows : ScriptedResponder) : NoReturn rows (internalCallFinish fn targets locals status) := by
  cases status <;> simp only [internalCallFinish]
  all_goals repeat' first | apply internalAssignNoReturn | apply revertNoReturn | split | (intro _ _ h;cases h)

end Inv12
