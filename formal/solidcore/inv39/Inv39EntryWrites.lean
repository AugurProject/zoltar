import Inv39InitSyntax
import Inv39Public
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Init
def returnedRecords (s : State) : CallResult → Prop | .returned post _ => Records s post | .reverted _ _ => True
theorem collected (s : State) (f : FunctionDef) (res : Result) (h : Records s res.runtime.state) : returnedRecords s (f.callBodyResult s res) := by
  cases res <;> simp only [FunctionDef.callBodyResult]
  all_goals repeat' split
  all_goals simp only [returnedRecords]
  all_goals first | trivial | exact unchanged (s:=_) h rfl
theorem entry (s post : State) (c : Context) (f : FunctionDef) (name : String) (args out : List Source.Value) (frame : Frame) (n : Nat)
    (found : model.core.findFunctionByName? name=some f) (body : accepts f.body) (ps : f.initialFrame? args=some frame)
    (ok : f.acceptsValue c.value) (good : safeFrame frame) (fields : c.storageFields=model.core.context.storageFields)
    (run : TypeCheck.CheckedContract.callTargetWithContext? n model (.name name) c s args=some (.returned post out)) : Records s post := by
  let r := (CheckedWordCall.initial c s).withFrame frame
  have start : f.evalBodyEntry n model.core.table c s args=some (Stmt.eval n model.core.table c r f.body) := by
    unfold FunctionDef.evalBodyEntry; rw [if_pos ok,ps]; rfl
  have initial : region s r := by
    refine ⟨unchanged (s:=s) ⟨⟨[],.initial⟩⟩ rfl,?_⟩
    intro l mem; change l∈[frame] at mem; simp only [List.mem_singleton] at mem; subst l; exact good
  have framed := sound s c fields f.body body n r initial
  have tagged : Frame.Ensures ((f.callBodyResult s) <$> Stmt.eval n model.core.table c r f.body) (returnedRecords s) := by
    apply Frame.bind framed
    intro res h; exact Frame.pureValue _ (collected s f res h.1)
  unfold TypeCheck.CheckedContract.callTargetWithContext? at run
  rw [Child.resolve _ _ _ _ _ found ps] at run
  change f.call? n model.core.table c s args=some (.returned post out) at run
  unfold FunctionDef.call? FunctionDef.call at run
  rw [start] at run
  cases ev:SolI.runWith [] (Functor.map (f.callBodyResult s) (Stmt.eval n model.core.table c r f.body)) with
  | error err => simp [ev,Option.map,Bind.bind,Option.bind] at run
  | ok result => simp [ev,Option.map,Bind.bind,Option.bind] at run; subst result; exact Frame.selected tagged [] _ ev
end Inv39.Init
