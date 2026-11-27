import Inv12CashPath
import Inv12CutLookup
open SolidCore.Solidity.Source
namespace Inv12

theorem functionBodyAccounting (n : Nat) (c : Context) (start final : Runtime) (rows : ScriptedResponder)
    (body : List Stmt) (origin : chooseBody=some body)
    (run : (Stmt.evalList n model.core.table c start body).runWith rows=.ok (.normal final)) :
    ∃ mid last, (Stmt.evalList n model.core.table c start (body.take (beforeCredit body))).runWith rows=.ok (.normal mid) ∧
      (Stmt.evalList n model.core.table c mid cashCode).runWith rows=.ok (.normal last) ∧
      (Stmt.evalList n model.core.table c last ((body.drop (beforeCredit body)).drop 9)).runWith rows=.ok (.normal final) := by
  have shape : directSlice=some cashCode := cashPathChecked
  rw [sliceProjects,origin] at shape
  have actual : cutPath body=cashCode := Option.some.inj shape
  obtain ⟨mid,last,pre,core,suffix⟩ := completeBodyPassesThrough _ _ _ _ _ _ _ run
  exact ⟨mid,last,pre,actual ▸ core,suffix⟩
end Inv12
