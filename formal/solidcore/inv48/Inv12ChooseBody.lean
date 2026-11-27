import Inv12RunSplit
import Inv12ChoiceTransition
import Inv12Model
open SolidCore.Solidity.Source
namespace Inv12

def chooseInner (fn : FunctionDef) : Option (List Stmt) := do
  let .block [_,_,.block [.block [_,_,.captureReturn [] (.block body),_]]] := fn.body | none
  pure body

def chooseBody := (model.core.findFunctionByName? "choose").bind chooseInner
def beforeCredit (body : List Stmt) := (body.takeWhile (fun s => !missingGuard s)).length-3
def cutPath (body : List Stmt) := (body.drop (beforeCredit body)).take 9

theorem decomposition (body : List Stmt) :
    body=body.take (beforeCredit body)++(cutPath body++(body.drop (beforeCredit body)).drop 9) := by
  simp [cutPath]

theorem completeBodyPassesThrough (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (rows : ScriptedResponder) (body : List Stmt)
    (returns : (Stmt.evalList n t c r body).runWith rows=.ok (.normal final)) :
    ∃ initial last, (Stmt.evalList n t c r (body.take (beforeCredit body))).runWith rows=.ok (.normal initial) ∧
      (Stmt.evalList n t c initial (cutPath body)).runWith rows=.ok (.normal last) ∧
      (Stmt.evalList n t c last ((body.drop (beforeCredit body)).drop 9)).runWith rows=.ok (.normal final) := by
  have run := returns
  conv at run => lhs; arg 2; arg 5; rw [decomposition body]
  obtain ⟨initial,A,B⟩ := splitNormal _ _ _ _ _ _ _ _ run
  obtain ⟨last,C,D⟩ := splitNormal _ _ _ _ _ _ _ _ B
  exact ⟨initial,last,A,C,D⟩
end Inv12
