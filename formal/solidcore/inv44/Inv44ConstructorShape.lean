import Inv44Getter
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv44.Constructor
abbrev name := "_deploymentAddresses"
abbrev ty := Source.Ty.dynamicArray .address
abbrev reason := "DeploymentStatusOracle supports at most 256 deployment steps"
def length := Inv08.Authority.length (varP name)
def limit := Inv08.Authority.dclean (Expr_binary BinaryOp_add (clean (Inv08.Authority.convert 256 (num 255))) (num 1))
def test := Expr_binary BinaryOp_le (clean length) limit
def guard := Inv08.Authority.guard test reason
def writes : List Source.Stmt := [.assign (.storage addresses) (.var name),.emitEvent "DeploymentAddressesSet" [.var name]]
private def recognized : Source.Stmt → Bool
  | .block [.skip,.memoryLocalize (.dynamicArray .address) "_deploymentAddresses",.block [check,
    .assign (.storage "deploymentAddresses") (.var "_deploymentAddresses"),
    .emitEvent "DeploymentAddressesSet" [.var "_deploymentAddresses"]]]=>guard.test check
  | _=>false
def sourceFn? := TypeCheck.CheckedProgram.constructorFunctionFor? model.program model.decl
theorem existsFn : sourceFn?.isSome := by native_decide
def ctor := sourceFn?.get existsFn
theorem bodyFromSource : ctor.body=.block [.skip,.memoryLocalize ty name,.block (guard.value::writes)] := by
  have h : recognized ctor.body := by native_decide
  generalize ctor.body=b at *
  unfold recognized at h
  split at h
  · rw [guard.sound _ h];rfl
  · contradiction
def param : BindingDecl := {name:=name,ty:=ty}
private def signature : List BindingDecl → Bool
  | [⟨"_deploymentAddresses",.dynamicArray .address,false⟩] => true
  | _ => false
theorem params : ctor.params=[param] := by
  have h : signature ctor.params := by native_decide
  generalize ctor.params=ps at *
  unfold signature at h; split at h
  · rfl
  · contradiction
theorem returns : ctor.returns=[] := Inv32Library.sound ctor.returns [] (by native_decide)
def array (xs : List Nat) := Value.dynamicArray (xs.map Value.word)
theorem coerced (xs : List Nat) : ty.coerceValue? (array xs) = some (array xs) := by
  have h : Source.Ty.coerceValueList? .address (xs.map Value.word)=some (xs.map Value.word) := by
    induction xs with
    | nil => rw [List.map_nil,Ty.coerceValueList?]
    | cons x xs ih => simp only [List.map_cons,Ty.coerceValueList?,Ty.coerceValue?,ih,Bind.bind,Option.bind]
  simp [array,Ty.coerceValue?,h]
def frame (v : Value) : Frame := [(name,v)]
theorem initial (xs : List Nat) : ctor.initialFrame? [array xs]=some (frame (array xs)) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,returns]
  simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,param,coerced,frame]
end Inv44.Constructor
