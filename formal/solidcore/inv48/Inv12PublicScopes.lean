import Inv12RegisteredExecution
import Inv12PublicFold
open SolidCore.Solidity.Source
namespace Inv12

theorem normalBlock (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (rows : ScriptedResponder) (stmts : List Stmt)
    (ok : (Stmt.eval (n+1) t c r (.block stmts)).runWith rows=.ok (.normal final)) :
    ∃ inner, (Stmt.evalList n t c r.pushScope stmts).runWith rows=.ok (.normal inner) ∧
      inner.popScope=final := by
  rw [Stmt.eval] at ok
  dsimp only at ok
  rw [runWithBind] at ok
  cases h : (Stmt.evalList n t c r.pushScope stmts).runWith rows with
  | error e => rw [h] at ok;cases ok
  | ok status =>
    rw [h] at ok
    cases status <;> try cases ok
    all_goals exact ⟨_,rfl,rfl⟩

theorem singleNormal (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (rows : ScriptedResponder) (stmt : Stmt)
    (ok : (Stmt.evalList n t c r [stmt]).runWith rows=.ok (.normal final)) :
    (Stmt.eval n t c r stmt).runWith rows=.ok (.normal final) := by
  rw [Stmt.evalList,runWithBind] at ok
  cases h : (Stmt.eval n t c r stmt).runWith rows with
  | error e => rw [h] at ok;cases ok
  | ok res =>
    rw [h] at ok
    cases res <;> try cases ok
    all_goals simpa only [Bind.bind,Except.bind,Stmt.evalList] using ok

theorem middleNormal (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (rows : ScriptedResponder) (pre post : List Stmt) (stmt : Stmt)
    (ok : (Stmt.evalList n t c r (pre++stmt::post)).runWith rows=.ok (.normal final)) :
    ∃ entry exit, (Stmt.evalList n t c r pre).runWith rows=.ok (.normal entry) ∧
      (Stmt.eval n t c entry stmt).runWith rows=.ok (.normal exit) ∧
      (Stmt.evalList n t c exit post).runWith rows=.ok (.normal final) := by
  obtain ⟨entry,p,rest⟩ := splitNormal _ _ _ _ _ _ _ _ ok
  obtain ⟨exit,s,q⟩ := splitNormal _ _ _ _ _ _ [stmt] post rest
  exact ⟨entry,exit,p,singleNormal _ _ _ _ _ _ _ s,q⟩

end Inv12
