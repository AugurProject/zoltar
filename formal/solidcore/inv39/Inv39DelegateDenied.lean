import Inv39DelegateFailure
import Inv39PublicDelegate
import Inv39DenyEntry
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
theorem failureCongr {s t : State} {x y sp old v err} (eq : t.storage=s.storage) (bad : Failure s x y sp old v err) : Failure t x y sp old v err := by
  cases bad with
  | charge bounded reason => exact .charge bounded reason
  | move allowed owner spender reason =>
    apply Failure.move allowed owner spender
    cases reason with
    | zero z => exact .zero z
    | low xn yn low =>
      apply Transfer.Rejection.low xn yn
      by_cases finite : old<R-1 <;> simpa only [afterSpend,finite,if_true,if_false,State.loadSlot,State.storeSlot,eq] using low
theorem publicDenied (s : State) (x y sp self old v : Nat) (xw : x<2^160) (yw : y<2^160) (sw : sp<2^160) (vf : v<R)
    (atSlot : s.loadSlot (slot x sp)=old) (oldFit : old<R) (err : RevertData) (bad : Failure s x y sp old v err) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom") (Child.callContext sp self) s [.word x,.word y,.word v]=
      some (.reverted s err.untagFixedBytes) := by
  obtain ⟨fn,found,ps,rs,bd⟩ := delegateLink
  let c := Child.callContext sp self
  let r := CheckedWordCall.initial c s
  let enter := delegateStart r x y v
  let outer := enter.pushScope
  let fetched := Child.stateTmp outer sp
  let named := fetched.declareLocal "spender" (.word sp)
  have z := Transfer.zeroAddress 49997 model.core.table c outer.pushScope Transfer.tmp
  have get := Transfer.fetchRun 49992 c outer
  have decl := Inv32Hoist.declEval 49997 model.core.table c fetched "spender" .address (.var Transfer.tmp) sp (Inv32Guards.readWord _ _ _ _ _ rfl) rfl
  obtain ⟨q,fail⟩ := denyInner 49981 c named x y v old rfl rfl rfl rfl atSlot oldFit vf xw yw sw err (failureCongr (s:=s) (t:=named.state) rfl bad) rfl rfl
  have block := Inv32Revert.blockRevert 49998 model.core.table c outer q _ _ ((seqStep _ _ _ _ _ _ _ z).trans
    ((seqStep _ _ _ _ _ _ _ get).trans ((seqStep _ _ _ _ _ _ _ decl).trans fail)))
  have sk : Stmt.eval 49999 model.core.table c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have prm := cleanParamExec 49998 model.core.table c outer "value" v vf rfl (by dsimp [outer,enter,delegateStart]; write_param)
  have ev := Inv32Revert.blockRevert 49999 model.core.table c enter q.popScope _ err ((seqStep _ _ _ _ _ _ _ sk).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ prm).trans ((seqStep _ _ _ _ _ _ _ sk).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ block)))))
  have frame : fn.initialFrame? [.word x,.word y,.word v]=some [("from",.word x),("to",.word y),("value",.word v),("_ret0",.word 0)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?,BindingDecl.defaultBinding,Ty.defaultValue]
  have ok : fn.acceptsValue c.value=true := by simp [c,Child.callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
  apply Child.denied s c fn _ _ _ _ found frame ok q.popScope.popScope err
  rw [bd]; exact ev
end Inv39.Allowance
