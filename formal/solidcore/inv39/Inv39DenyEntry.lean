import Inv39Public
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Child
theorem denied (s : State) (c : Context) (f : FunctionDef) (name : String) (args : List Source.Value) (frame : Source.Frame) (n : Nat)
    (found : model.core.findFunctionByName? name=some f) (ps : f.initialFrame? args=some frame) (ok : f.acceptsValue c.value)
    (next : Runtime) (err : RevertData) (body : Stmt.eval n model.core.table c ((CheckedWordCall.initial c s).withFrame frame) f.body=pure (.reverted next err)) :
    TypeCheck.CheckedContract.callTargetWithContext? n model (.name name) c s args=some (.reverted s err.untagFixedBytes) := by
  have start : f.evalBodyEntry n model.core.table c s args=some (Stmt.eval n model.core.table c ((CheckedWordCall.initial c s).withFrame frame) f.body) := by
    unfold FunctionDef.evalBodyEntry; rw [if_pos ok,ps]; rfl
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [resolve _ _ _ _ _ found ps]
  change f.call? n model.core.table c s args=_
  unfold FunctionDef.call? FunctionDef.call
  rw [start,body]; rfl
end Inv39.Child
