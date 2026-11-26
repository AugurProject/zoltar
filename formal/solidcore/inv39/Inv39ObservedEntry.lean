import Inv39AuthSeq
import Inv39EntryWrites
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Auth
def returnedWith (P : StorageMap→Prop) : CallResult→Prop | .returned s _=>P s.storage | .reverted _ _=>True
theorem collectNormal (P : StorageMap→Prop) (s : State) (f : FunctionDef) (res : Result) (h : normal (fun q=>P q.state.storage) res) :
    returnedWith P (f.callBodyResult s res) := by
  cases res <;> first | contradiction | skip
  all_goals simp only [FunctionDef.callBodyResult]
  all_goals repeat' split
  all_goals first | exact h | trivial
theorem entryStorage (P : StorageMap→Prop) (s after : State) (c : Context) (f : FunctionDef) (name : String) (args out : List Source.Value) (frame : Frame) (n : Nat)
    (found : model.core.findFunctionByName? name=some f) (ps : f.initialFrame? args=some frame) (ok : f.acceptsValue c.value)
    (evalBody : Fold.Ensures (Stmt.eval n model.core.table c ((CheckedWordCall.initial c s).withFrame frame) f.body) (normal (fun q=>P q.state.storage)))
    (run : TypeCheck.CheckedContract.callTargetWithContext? n model (.name name) c s args=some (.returned after out)) : P after.storage := by
  let rt := (CheckedWordCall.initial c s).withFrame frame
  have start : f.evalBodyEntry n model.core.table c s args=some (Stmt.eval n model.core.table c rt f.body) := by
    unfold FunctionDef.evalBodyEntry; rw [if_pos ok,ps]; rfl
  have tag : Fold.Ensures ((f.callBodyResult s) <$> Stmt.eval n model.core.table c rt f.body) (returnedWith P) := by
    apply Fold.bind (Q:=returnedWith P) evalBody
    intro res h; exact Fold.pureValue _ _ (collectNormal P s f res h)
  unfold TypeCheck.CheckedContract.callTargetWithContext? at run
  rw [Child.resolve _ _ _ _ _ found ps] at run
  change f.call? n model.core.table c s args=some (.returned after out) at run
  unfold FunctionDef.call? FunctionDef.call at run
  rw [start] at run
  cases ev:SolI.runWith [] (Functor.map (f.callBodyResult s) (Stmt.eval n model.core.table c rt f.body)) with
  | error err=>simp [ev,Option.map,Bind.bind,Option.bind] at run
  | ok result=>simp [ev,Option.map,Bind.bind,Option.bind] at run; subst result; unfold Fold.Ensures at tag; exact tag _ ev
end Inv39.Auth
