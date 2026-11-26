import Inv39GuardOverflow
import Inv39Public
import Inv39Authority
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Child
/-- Both public methods run their accounting body inside the same Zoltar-only modifier. -/
theorem wrapRejected (k : Kind) (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (a v : Nat)
    (fit : v<R) (senderFit : c.sender<R) (fields : c.immutableFields=model.core.context.immutableFields)
    (authorized : r.state.immutable? "zoltar"=some (.word c.sender)) (next : Runtime) (err : RevertData)
    (body : Stmt.eval (n+1) t c (enter r a v).pushScope.pushScope.pushScope (effects k).value = pure (.reverted next err)) :
    Stmt.eval (n+5) t c (enter r a v) (shape k).value = pure (.reverted next.popScope.popScope.popScope err) := by
  let start := enter r a v
  let outer := start.pushScope
  let middle := outer.pushScope
  let inner := middle.pushScope
  have guard := Inv39.authorized c t inner (n+1) fields senderFit authorized
  have call := Inv32Revert.capture _ t c inner next _ [] err body
  have modBlock := Inv32Revert.blockRevert (n+2) t c middle next _ err ((seqStep _ _ _ _ _ _ _ guard).trans
    (Inv32Revert.stop _ _ _ _ _ _ [] _ call))
  have group := Inv32Revert.blockRevert _ t c outer next.popScope _ err (Inv32Revert.stop _ _ _ _ _ _ [] _ modBlock)
  have skip : Stmt.eval (n+4) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have param := cleanParamExec (n+3) t c outer "valueAttoRep" v fit rfl (by dsimp [outer,start,enter]; write_param)
  apply Inv32Revert.blockRevert
  exact (seqStep _ _ _ _ _ _ _ skip).trans ((seqStep _ _ _ _ _ _ _ param).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ group))
theorem dispatchRejected (k : Kind) (s : State) (sender self a v : Nat) (next : Runtime) (err : RevertData)
    (ev : let c := callContext sender self
          Stmt.eval 50000 model.core.table c (enter (CheckedWordCall.initial c s) a v) (shape k).value = pure (.reverted next err)) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name (entryName k)) (callContext sender self) s [.word a,.word v] =
      some (.reverted s err.untagFixedBytes) := by
  obtain ⟨f,found,ps,rs,bd⟩ := linked k
  let c := callContext sender self
  let r := enter (CheckedWordCall.initial c s) a v
  have frame : f.initialFrame? [.word a,.word v] = some [("account",.word a),("valueAttoRep",.word v)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?]
  have ok : f.acceptsValue c.value=true := by simp [c,callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
  have start : f.evalBodyEntry 50000 model.core.table c s [.word a,.word v] =
      some (Stmt.eval 50000 model.core.table c r f.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos ok,frame]; rfl
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [resolve _ _ _ _ _ found frame]
  change f.call? 50000 model.core.table c s [.word a,.word v] = _
  unfold FunctionDef.call? FunctionDef.call
  rw [start,bd]
  change Stmt.eval 50000 _ c r _ = pure (.reverted next err) at ev
  rw [ev]
  rfl
theorem aboveCap (s : State) (sender self a v : Nat) (senderFit : sender<R) (authorized : s.immutable? "zoltar"=some (.word sender)) (vFit : v<R)
    (issuedFit : s.loadSlot circulating.slot<R) (capFit : s.loadSlot theoretical.slot<R)
    (high : s.loadSlot theoretical.slot<s.loadSlot circulating.slot+v) :
    ∃ err, TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "mint") (callContext sender self) s [.word a,.word v] =
      some (.reverted s err) := by
  let c := callContext sender self
  let r := CheckedWordCall.initial c s
  let inner := (enter r a v).pushScope.pushScope.pushScope
  let guardRt := inner.pushScope
  have propagate (err : RevertData) (bad : Stmt.eval 49995 model.core.table c guardRt mintGuard.value=pure (.reverted guardRt err)) :
      ∃ e, TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "mint") c s [.word a,.word v]=some (.reverted s e) := by
    have failing := Inv32Revert.blockRevert 49995 model.core.table c inner guardRt _ err
      (Inv32Revert.stop _ _ _ _ _ _ [(go .mint).value,(logged .mint).value] _ bad)
    have wrapped := wrapRejected .mint 49995 model.core.table c r a v vFit senderFit rfl authorized _ _ failing
    exact ⟨_,dispatchRejected .mint _ _ _ _ _ _ _ wrapped⟩
  by_cases fits : s.loadSlot circulating.slot+v<R
  · apply propagate (.error "Mint exceeds theoretical supply")
    exact guardReject 49988 c guardRt _ v _ rfl rfl rfl capFit fits high rfl
  · apply propagate .overflow
    exact guardOverflow 49988 c guardRt _ v _ rfl rfl (show guardRt.state.loadSlot theoretical.slot=s.loadSlot theoretical.slot from rfl) issuedFit vFit (Nat.le_of_not_gt fits) rfl rfl
end Inv39.Child
