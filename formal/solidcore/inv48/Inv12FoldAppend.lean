import Inv12Fold
open SolidCore.Solidity.Source
namespace Inv12

theorem normalAppend (n : Nat) (t : FunctionTable) (c : Context) (r after : Runtime) (rows : ScriptedResponder)
    (body rest : List Stmt) (run : (Stmt.evalList n t c r body).runWith rows=.ok (.normal after)) :
    (Stmt.evalList n t c r (body++rest)).runWith rows=(Stmt.evalList n t c after rest).runWith rows := by
  induction body generalizing r with
  | nil =>
    rw [Stmt.evalList] at run
    have eq : (Except.ok (.normal r) : Except ResponderFailure Result)=.ok (.normal after) := run
    cases eq; rfl
  | cons stmt tail ih =>
    rw [Stmt.evalList,runWithBind] at run
    rw [List.cons_append,Stmt.evalList,runWithBind]
    cases h : (Stmt.eval n t c r stmt).runWith rows with
    | error err => rw [h] at run;cases run
    | ok result =>
      rw [h] at run
      cases result <;> first | exact ih _ run | cases run
end Inv12
