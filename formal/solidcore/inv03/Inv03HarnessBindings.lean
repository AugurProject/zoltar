import Inv03Harness
import CheckedWordCall

open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv03.Harness
def selected := model.core.findFunctionByName? "feeBudget"
private theorem present : selected.isSome := by native_decide
def fn := selected.get present
theorem checkedBody : fn.body = shape.value := shape.sound _ (by native_decide)
theorem params : fn.params = Inv32Internal.wordBindings names := Inv32Internal.wordBindingsOf _ _ (by native_decide)
theorem returns : fn.returns = Inv32Internal.wordBindings ["_ret0"] := Inv32Internal.wordBindingsOf _ _ (by native_decide)
theorem accepts : fn.acceptsValue (CheckedWordCall.ctx model).value = true := by native_decide

theorem frameOk (q s rate net total : Nat) : fn.initialFrame? (args q s rate net total) = some (frame q s rate net total) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,returns]
  simp [args,frame,names,Inv32Internal.wordBindings,BindingDecl.bindArgs?,BindingDecl.bindArg?,
    BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue]

end Inv03.Harness
