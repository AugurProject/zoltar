import Inv06Harness
import CheckedWordCall

open SolidCore.Solidity SolidCore.Solidity.Source
open Inv03
namespace Inv06.Harness
def selected := model.core.findFunctionByName? "cashForUnits"
private theorem present : selected.isSome := by native_decide
def fn := selected.get present
theorem checkedBody : fn.body = shape.value := shape.sound _ (by native_decide)
theorem params : fn.params = Inv32Internal.wordBindings names := Inv32Internal.wordBindingsOf _ _ (by native_decide)
theorem returns : fn.returns = Inv32Internal.wordBindings ["_ret0"] := Inv32Internal.wordBindingsOf _ _ (by native_decide)
theorem accepts : fn.acceptsValue (CheckedWordCall.ctx model).value = true := by native_decide

theorem frameOk (cash units carry burned : Nat) : fn.initialFrame? (args cash units carry burned) = some (Cash.frame cash units carry burned) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,returns]
  simp [args,Cash.frame,names,Inv32Internal.wordBindings,BindingDecl.bindArgs?,BindingDecl.bindArg?,
    BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue]

end Inv06.Harness
