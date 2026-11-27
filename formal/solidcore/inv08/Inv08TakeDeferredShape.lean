import Inv08CheckpointDeferred
import Inv08Authority
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.TakeDeferred
def copy (eth : Bool) := assign (amountLocal eth) (clean (Expiry.refField (Checkpoint.deferredField eth).name))
def clear (eth : Bool) : Pattern Stmt where
  value := .assign (.storage (Checkpoint.deferredField eth).name) (.word 0)
  test | .assign (.storage name) (.word 0) => name==(Checkpoint.deferredField eth).name | _=>false
  sound v h := by
    split at h
    · rw [beq_iff_eq.mp h]
    · contradiction
def inner := block [copy true,copy false,clear true,clear false]
def captured := Stmt_captureReturn (seq [lit "ethAmount",lit "repAmount"]) inner
def modifierBody := block [Authority.callerGuard,Authority.initializedGuard,captured]
def body := block [Stmt_skip,Stmt_skip,block [modifierBody]]
theorem present : (model.core.findFunctionByName? "takeDeferred").isSome := by native_decide
def fn := (model.core.findFunctionByName? "takeDeferred").get present
theorem generatedBody : fn.body=body.value := body.sound _ (by native_decide)
theorem params : fn.params=[] := Inv32Library.sound fn.params [] (by native_decide)
theorem results : fn.returns=[Inv32Library.decl (.word "ethAmount"),Inv32Library.decl (.word "repAmount")] :=
  Inv32Library.sound fn.returns [.word "ethAmount",.word "repAmount"] (by native_decide)
def frame (a b : Nat) : Frame := [("ethAmount",.word a),("repAmount",.word b)]
theorem initial : fn.initialFrame? []=some (frame 0 0) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,results]; simp [BindingDecl.bindArgs?,BindingDecl.defaultBinding,Inv32Library.decl,Ty.defaultValue,frame]
theorem dispatch : model.core.resolveCallFunction? (.name "takeDeferred") []=some fn := by
  have found : model.core.findFunctionByName? "takeDeferred"=some fn := (Option.some_get present).symm
  obtain ⟨nameOk,before,after,decomp,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,decomp,?_⟩
  · simp only [nameOk,initial,Option.isSome_some,Bool.true_and]
  · intro f mem; have absent := skip f mem; simp_all
end Inv08.TakeDeferred
