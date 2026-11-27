import Inv12FoldAppend
open SolidCore.Solidity.Source
namespace Inv12

theorem splitNormal (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime) (rows : ScriptedResponder)
    (first last : List Stmt) (success : (Stmt.evalList n t c r (first++last)).runWith rows=.ok (.normal final)) :
    ∃ mid, (Stmt.evalList n t c r first).runWith rows=.ok (.normal mid) ∧
      (Stmt.evalList n t c mid last).runWith rows=.ok (.normal final) := by
  induction first generalizing r with
  | nil => exact ⟨r,by rw [Stmt.evalList];rfl,success⟩
  | cons stmt tail ih =>
    rw [List.cons_append,Stmt.evalList,runWithBind] at success
    cases step : (Stmt.eval n t c r stmt).runWith rows with
    | error err => rw [step] at success;cases success
    | ok res =>
      rw [step] at success
      cases res <;> try cases success
      rename_i next
      obtain ⟨mid,A,B⟩ := ih next success
      exact ⟨mid,(externalSeq _ _ _ _ _ _ _ _ step).trans A,B⟩

end Inv12
