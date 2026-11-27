import Inv39DirectApprove
import Inv39DenyEntry
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
theorem directLink : ∃ f, model.core.findFunctionByName? "approve"=some f ∧ f.params=[⟨"spender",.address,false⟩,⟨"value",.uint256,false⟩] ∧
    f.returns=[⟨"_ret0",.bool,false⟩] ∧ f.body=directShape.value := by
  have both := approveChecked; simp only [Bool.and_eq_true] at both
  have cert := both.2; unfold directFound at cert
  cases eq:model.core.findFunctionByName? "approve" with
  | none => simp [eq] at cert
  | some f =>
    simp only [eq,Option.map_some,beq_iff_eq,Option.some.injEq,Bool.and_eq_true] at cert
    obtain ⟨m,b⟩ := cert
    refine ⟨f,rfl,?_,?_,directShape.sound _ b⟩ <;> unfold directMeta at m <;> split at m <;> simp_all
theorem actualApproval (s post : State) (sender self sp v : Nat) (out : List Source.Value) (ow : sender<2^160) (sw : sp<2^160) (vf : v<R)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "approve") (Child.callContext sender self) s [.word sp,.word v]=some (.returned post out)) :
    post.storage=(s.storeSlot (slot sender sp) v).storage := by
  obtain ⟨f,found,ps,rs,bd⟩ := directLink
  let c := Child.callContext sender self
  let r := CheckedWordCall.initial c s
  have frame : f.initialFrame? [.word sp,.word v]=some [("spender",.word sp),("value",.word v),("_ret0",.word 0)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings; rw [ps,rs]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?,BindingDecl.defaultBinding,Ty.defaultValue]
  have ok : f.acceptsValue c.value=true := by simp [c,Child.callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
  obtain ⟨q,bad|⟨ev,stored⟩⟩ := directBody 49985 c r sp v ow sw vf rfl rfl
  · have denied := Child.denied s c f "approve" [.word sp,.word v] _ 50000 found frame ok q _ (bd ▸ bad)
    rw [run] at denied; cases denied
  · have start : f.evalBodyEntry 50000 model.core.table c s [.word sp,.word v]=some (Stmt.eval 50000 model.core.table c (directStart r sp v) f.body) := by
      unfold FunctionDef.evalBodyEntry; rw [if_pos ok,frame]; rfl
    unfold TypeCheck.CheckedContract.callTargetWithContext? at run
    rw [Child.resolve _ _ _ _ _ found frame] at run
    change f.call? 50000 model.core.table c s [.word sp,.word v]=_ at run
    unfold FunctionDef.call? FunctionDef.call at run
    rw [start,bd,ev] at run
    change some (f.callBodyResult s (.returned q [.word 1]))=some (.returned post out) at run
    simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,coerceReturnBindings,coerceReturnBindings.coerce,rs,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,Value.untagFixedBytes,wordEq] at run
    obtain ⟨h,_⟩ := run; subst post; exact stored
end Inv39.Allowance
