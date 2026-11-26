import Inv39DelegateBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
theorem delegateLink : ∃ f, model.core.findFunctionByName? "transferFrom"=some f ∧ f.params=[⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩] ∧
    f.returns=[⟨"_ret0",.bool,false⟩] ∧ f.body=publicShape.value := by
  have all := spendChecked; simp only [Bool.and_eq_true] at all
  have ok := all.2
  unfold foundPublic at ok
  cases eq:model.core.findFunctionByName? "transferFrom" with
  | none => simp [eq] at ok
  | some f =>
    simp only [eq,Option.map_some,beq_iff_eq,Option.some.injEq,Bool.and_eq_true] at ok
    obtain ⟨m,b⟩ := ok
    refine ⟨f,rfl,?_,?_,publicShape.sound _ b⟩ <;> unfold matchesPublic at m <;> split at m <;> simp_all
theorem publicTransferFrom (s : State) (A : Nat → Prop) (b : Balances) (src dst val caller self old : Nat)
    (sv : src<2^160) (dv : dst<2^160) (cv : caller<2^160) (sn : src≠0) (dn : dst≠0) (cn : old<R-1 → caller≠0) (S : A src) (D : A dst)
    (atSlot : s.loadSlot (slot src caller)=old) (oldFit : old<R) (allowed : old<R-1 → val≤old) (separate : old<R-1 → Separate A src caller)
    (sep : SlotSeparation A) (book : Books A s b) (enough : val≤balance src b) (fit : total b<R) :
    ∃ post, TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom") (Child.callContext caller self) s [.word src,.word dst,.word val] =
      some (.returned post [.word 1]) ∧ Books A post (move src dst val b) ∧ post.loadSlot theoretical.slot=s.loadSlot theoretical.slot := by
  obtain ⟨f,found,ps,rs,bd⟩ := delegateLink
  let c := Child.callContext caller self
  let r := CheckedWordCall.initial c s
  have frame : f.initialFrame? [.word src,.word dst,.word val] = some [("from",.word src),("to",.word dst),("value",.word val),("_ret0",.word 0)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?,BindingDecl.defaultBinding,Ty.defaultValue]
  have ok : f.acceptsValue c.value=true := by simp [c,Child.callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
  have beginCall : f.evalBodyEntry 50000 model.core.table c s [.word src,.word dst,.word val] =
      some (Stmt.eval 50000 model.core.table c (delegateStart r src dst val) f.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos ok,frame]; rfl
  obtain ⟨out,ev,books,cap⟩ := delegateBody 49981 c r A b src dst val old S D sv dv cv sn dn cn atSlot oldFit allowed separate (Books.ofStorageEq (s:=s) rfl book) sep enough fit rfl rfl
  let post := {out.state with constructorOutput? := none}
  refine ⟨post,?_,Books.ofStorageEq (s:=out.state) rfl books,cap⟩
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [Child.resolve _ _ _ _ _ found frame]
  change f.call? 50000 model.core.table c s [.word src,.word dst,.word val] = _
  unfold FunctionDef.call? FunctionDef.call
  rw [beginCall,bd,ev]
  change some (f.callBodyResult s (.returned out [.word 1]))=_
  simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,coerceReturnBindings,coerceReturnBindings.coerce,
    rs,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,Value.untagFixedBytes,wordEq,post]
end Inv39.Allowance
