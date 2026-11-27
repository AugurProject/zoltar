import Inv08AddStreamShapes
open SolidCore.Solidity.Source
namespace Inv08.AddStream
theorem present : (model.core.findFunctionByName? "addStream").isSome := by native_decide
def fn := (model.core.findFunctionByName? "addStream").get present
theorem generatedBody : fn.body=publicBody.value := publicBody.sound _ (by native_decide)
theorem params : fn.params=[Inv32Library.decl (.word "ethAmount"),Inv32Library.decl (.word "repAmount")] :=
  Inv32Library.sound fn.params [.word "ethAmount",.word "repAmount"] (by native_decide)
theorem results : fn.returns=[] := Inv32Library.sound fn.returns [] (by native_decide)
theorem initial (a b : Nat) : fn.initialFrame? [.word a,.word b]=some [("ethAmount",.word a),("repAmount",.word b)] := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,results]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Inv32Library.decl,Ty.coerceValue?]
theorem dispatch (a b : Nat) : model.core.resolveCallFunction? (.name "addStream") [.word a,.word b]=some fn := by
  have found : model.core.findFunctionByName? "addStream"=some fn := (Option.some_get present).symm
  obtain ⟨nameOk,before,after,decomp,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,decomp,?_⟩
  · simp only [nameOk,initial,Option.isSome_some,Bool.true_and]
  · intro f mem; have absent := skip f mem; simp_all
end Inv08.AddStream
