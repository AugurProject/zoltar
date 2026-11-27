import Inv12ChooseBody
namespace Inv12
open SolidCore.Solidity.Source
def directSlice : Option (List Stmt) := do
  let fn ← model.core.findFunctionByName? "choose"
  let .block [_,_,.block [.block [_,_,.captureReturn [] (.block body),_]]] := fn.body | none
  let count := (body.takeWhile (fun s => !missingGuard s)).length
  pure ((body.drop (count-3)).take 9)
theorem sliceProjects : directSlice=chooseBody.map cutPath := by
  unfold directSlice chooseBody
  cases h : model.core.findFunctionByName? "choose" with
  | none => rfl
  | some fn =>
    simp only [chooseInner,Bind.bind,Option.bind]
    split
    · rename_i eqn;rw [eqn];rfl
    · rename_i impossible
      split
      · rename_i eqn;exact False.elim (impossible _ _ _ _ _ _ eqn)
      · rfl
end Inv12
