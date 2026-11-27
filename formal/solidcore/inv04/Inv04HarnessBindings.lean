import Inv04Harness
import CheckedWordCall

open SolidCore.Solidity SolidCore.Solidity.Source
open Inv03
namespace Inv04.Harness
def selected := model.core.findFunctionByName? "requiredCash"
private theorem present : selected.isSome := by native_decide
def fn := selected.get present
theorem checkedBody : fn.body = shape.value := shape.sound _ (by native_decide)
theorem params : fn.params = Inv32Internal.wordBindings names := Inv32Internal.wordBindingsOf _ _ (by native_decide)
theorem returns : fn.returns = Inv32Internal.wordBindings ["_ret0"] := Inv32Internal.wordBindingsOf _ _ (by native_decide)
theorem accepts : fn.acceptsValue (CheckedWordCall.ctx model).value = true := by native_decide

theorem frameOk (u n d rem : Nat) : fn.initialFrame? (args u n d rem) = some (Cash.frame u n d rem) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,returns]
  simp [args,Cash.frame,names,Inv32Internal.wordBindings,BindingDecl.bindArgs?,BindingDecl.bindArg?,
    BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue]

end Inv04.Harness
