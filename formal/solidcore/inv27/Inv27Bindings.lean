import Inv27Calls
import CheckedWordCall
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32FloorFastPath Inv32Hoist Inv32Actions Inv32QuoteExpr Inv03.Bodies
namespace Inv27.Harness
def hoisted (cons : Bool) := hoist (key cons) (slot cons) [(a0,wvar "price"),(a1,wvar "uncertainty")]
def shape (cons : Bool) := Inv03.Bodies.block [param "price",param "uncertainty",Inv32Shapes.Stmt_skip,
  Inv03.Bodies.block [decl tmp Inv32Shapes.Option_none,hoisted cons,ret copied]]
def selected (cons : Bool) := Inv03.model.core.findFunctionByName? (apiName cons)
private theorem present (cons : Bool) : (selected cons).isSome := by cases cons <;> native_decide
def fn (cons : Bool) := (selected cons).get (present cons)
theorem checkedBody (cons : Bool) : (fn cons).body = (shape cons).value :=
  (shape cons).sound _ (by cases cons <;> native_decide)
def args (p e : Nat) : List Value := [.word p,.word e]
theorem params (cons : Bool) : (fn cons).params = Inv32Internal.wordBindings ["price","uncertainty"] :=
  Inv32Internal.wordBindingsOf _ _ (by cases cons <;> native_decide)
theorem returns (cons : Bool) : (fn cons).returns = Inv32Internal.wordBindings ["_ret0"] :=
  Inv32Internal.wordBindingsOf _ _ (by cases cons <;> native_decide)
theorem accepts (cons : Bool) : (fn cons).acceptsValue (CheckedWordCall.ctx Inv03.model).value = true := by
  cases cons <;> native_decide
theorem frameOk (cons : Bool) (p e : Nat) : (fn cons).initialFrame? (args p e) = some (frame p e) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,returns]
  simp [args,frame,Inv32Internal.wordBindings,BindingDecl.bindArgs?,BindingDecl.bindArg?,
    BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue]
end Inv27.Harness
