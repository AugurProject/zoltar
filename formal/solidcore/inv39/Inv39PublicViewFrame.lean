import Inv39MarkerExecution
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Init.MarkerHistory

theorem publicViewFrame (fuel : Nat) (s post : State) (c : Context) (name : String) (fn : FunctionDef)
    (args out : List Source.Value) (fr : Frame)
    (registered : model.core.findFunctionByName? name=some fn) (frame : fn.initialFrame? args=some fr)
    (ok : fn.acceptsValue c.value) (plain : Frame.plainFrame fr)
    (code : Frame.StmtPreserves (Frame.region s) model.core.table c fn.body)
    (run : TypeCheck.CheckedContract.callTargetWithContext? fuel model (.name name) c s args=some (.returned post out)) :
    post.storage=s.storage := by
  let rt := (CheckedWordCall.initial c s).withFrame fr
  have region : Frame.region s rt := by
    refine ⟨rfl,?_⟩
    intro f hf
    change f∈[fr] at hf
    exact List.mem_singleton.mp hf ▸ plain
  have start : fn.evalBodyEntry fuel model.core.table c s args=some (Stmt.eval fuel model.core.table c rt fn.body) := by
    unfold FunctionDef.evalBodyEntry;rw [if_pos ok,frame];rfl
  unfold TypeCheck.CheckedContract.callTargetWithContext? at run
  rw [Child.resolve _ _ _ _ _ registered frame] at run
  change fn.call? fuel model.core.table c s args=_ at run
  unfold FunctionDef.call? FunctionDef.call at run
  rw [start] at run
  have liftBody : (Functor.map (fn.callBodyResult s) (Stmt.eval fuel model.core.table c rt fn.body)).runWith [] =
      ((Stmt.eval fuel model.core.table c rt fn.body).runWith [] >>= fun v => .ok (fn.callBodyResult s v)) :=
    Fold.bindRun [] _ (fun v => pure (fn.callBodyResult s v))
  cases ev : (Stmt.eval fuel model.core.table c rt fn.body).runWith [] with
  | error err => simp [liftBody,ev,Bind.bind,Except.bind,Option.bind] at run
  | ok res =>
    have abi : fn.callBodyResult s res=.returned post out := by
      simpa [liftBody,ev,Bind.bind,Except.bind,Option.bind] using run
    exact (Marker.abiStorage _ _ _ _ _ abi).trans (Frame.selected (code fuel rt region) [] res ev).1
#print axioms publicViewFrame
end Inv39.Init.MarkerHistory
