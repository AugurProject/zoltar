import Inv39TransferBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Transfer
theorem publicTransfer (s : State) (A : Nat → Prop) (b : Balances) (src dst val self : Nat)
    (sv : src<2^160) (dv : dst<2^160) (sn : src≠0) (dn : dst≠0) (S : A src) (D : A dst)
    (sep : SlotSeparation A) (book : Books A s b) (enough : val≤balance src b) (fit : total b<R) :
    ∃ post, TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transfer") (Child.callContext src self) s [.word dst,.word val] =
      some (.returned post [.word 1]) ∧ Books A post (move src dst val b) ∧ post.loadSlot theoretical.slot=s.loadSlot theoretical.slot := by
  obtain ⟨f,found,ps,rs,bd⟩ := publicLink
  let c := Child.callContext src self
  let r := CheckedWordCall.initial c s
  have frame : f.initialFrame? [.word dst,.word val] = some [("to",.word dst),("value",.word val),("_ret0",.word 0)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?,BindingDecl.defaultBinding,Ty.defaultValue]
  have ok : f.acceptsValue c.value=true := by simp [c,Child.callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
  have beginCall : f.evalBodyEntry 50000 model.core.table c s [.word dst,.word val] =
      some (Stmt.eval 50000 model.core.table c (start r dst val) f.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos ok,frame]; rfl
  obtain ⟨out,ev,books,cap⟩ := body 49983 c r A b dst val sv dv sn dn S D sep (Books.ofStorageEq (s:=s) rfl book) enough fit rfl rfl
  let post := {out.state with constructorOutput? := none}
  refine ⟨post,?_,Books.ofStorageEq (s:=out.state) rfl books,cap⟩
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [Child.resolve _ _ _ _ _ found frame]
  change f.call? 50000 model.core.table c s [.word dst,.word val] = _
  unfold FunctionDef.call? FunctionDef.call
  rw [beginCall,bd,ev]
  change some (f.callBodyResult s (.returned out [.word 1]))=_
  simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,coerceReturnBindings,coerceReturnBindings.coerce,
    rs,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,Value.untagFixedBytes,wordEq,post]
end Inv39.Transfer
