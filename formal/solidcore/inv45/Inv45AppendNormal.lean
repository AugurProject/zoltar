import Inv45GuardedLabel
open SolidCore.Solidity.Source
namespace Inv45.Public

theorem appendNormal (n : Nat) (t : FunctionTable) (c : Context)
    (head tail : List Stmt) (r next : Runtime)
    (run : Stmt.evalList n t c r head = pure (.normal next)) :
    Stmt.evalList n t c r (head ++ tail) = Stmt.evalList n t c next tail := by
  induction head generalizing r with
  | nil =>
    rw [Stmt.evalList] at run
    cases run
    rfl
  | cons s rest ih =>
    simp only [List.cons_append, Stmt.evalList] at run ⊢
    cases h : Stmt.eval n t c r s with
    | done out =>
      cases out with
      | error e => rw [h] at run; cases run
      | ok v =>
        rw [h] at run
        cases v <;> first | exact ih _ run | cases run
    | request _ _ => rw [h] at run; cases run
#print axioms appendNormal
end Inv45.Public
