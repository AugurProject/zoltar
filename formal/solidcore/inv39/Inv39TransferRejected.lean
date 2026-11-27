import Inv39RejectedCall
import Inv39ZeroCall
import Inv39PublicTransfer
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Transfer
inductive Rejection (s : State) (src dst val : Nat) : RevertData → Prop where
  | low (sn : src≠0) (dn : dst≠0) (insufficient : s.loadSlot (balanceSlot src)<val) : Rejection s src dst val ERC20.lowFunds
  | zero (bad : Motion.invalidEndpoint .transfer src dst) : Rejection s src dst val (Motion.zeroError .transfer src)
theorem goRejected (n : Nat) (c : Context) (r : Runtime) (dst val : Nat)
    (X : r.lookupLocal? "owner"=some (.word c.sender)) (Y : r.lookupLocal? "to"=some (.word dst)) (Z : r.lookupLocal? "value"=some (.word val))
    (sv : c.sender<2^160) (dv : dst<2^160) (vw : val<R) (err : RevertData) (bad : Rejection r.state c.sender dst val err)
    (fields : c.storageFields=model.core.context.storageFields) :
    ∃ next, Stmt.eval (n+15) model.core.table c r go.value = pure (.reverted next err) := by
  let t := model.core.table
  let one := r.pushScope.declareLocal "_ic_arg_0" (.word c.sender)
  let two := one.declareLocal "_ic_arg_1" (.word dst)
  let three := two.declareLocal "_ic_arg_2" (.word val)
  have a := Inv32Hoist.declEval (n+13) t c r.pushScope "_ic_arg_0" .address (.var "owner") c.sender (Inv32Guards.readWord _ _ _ _ _ X) rfl
  have d := Inv32Hoist.declEval (n+13) t c one "_ic_arg_1" .address (.var "to") dst (Inv32Guards.readWord _ _ _ _ _ Y) rfl
  have v := Inv32Hoist.declEval (n+13) t c two "_ic_arg_2" .uint256 (Child.cv "value") val (Child.readClean _ _ _ _ _ vw Z) rfl
  have call : ∃ next, Stmt.eval (n+13) t c three (.internalCall [] (Motion.key .transfer)
      (Motion.exprs .transfer "_ic_arg_0" "_ic_arg_1" "_ic_arg_2"))=pure (.reverted next err) := by
    cases bad with
    | low sn dn low =>
      exact Motion.rejectedCall n c three .transfer c.sender dst val _ _ _ rfl (by intro; rfl) rfl sv dv vw sn (fun _ => dn) (by decide) low fields
    | zero bad =>
      exact Motion.zeroCall n c three .transfer c.sender dst val _ _ _ rfl (by intro; rfl) rfl sv dv vw bad
  obtain ⟨done,ev⟩ := call
  have cap := Inv32Revert.capture _ t c three done _ [] _ ev
  exact ⟨done.popScope,Inv32Revert.blockRevert _ t c r done _ _ ((seqStep _ _ _ _ _ _ _ a).trans
    ((seqStep _ _ _ _ _ _ _ d).trans ((seqStep _ _ _ _ _ _ _ v).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ cap))))⟩
theorem bodyRejected (n : Nat) (c : Context) (r : Runtime) (dst val : Nat)
    (sv : c.sender<2^160) (dv : dst<2^160) (vw : val<R) (err : RevertData)
    (bad : Rejection r.state c.sender dst val err) (fields : c.storageFields=model.core.context.storageFields) :
    ∃ next, Stmt.eval (n+17) model.core.table c (start r dst val) shape.value=pure (.reverted next err) := by
  let t := model.core.table
  let outer := (start r dst val).pushScope
  let src := Child.stateTmp outer c.sender
  let owned := src.declareLocal "owner" (.word c.sender)
  have z := zeroAddress (n+14) t c outer.pushScope tmp
  have get := fetchRun (n+9) c outer
  have owner := Inv32Hoist.declEval (n+14) t c src "owner" .address (.var tmp) c.sender (Inv32Guards.readWord _ _ _ _ _ rfl) rfl
  obtain ⟨out,fail⟩ := goRejected n c owned dst val rfl rfl rfl sv dv vw err bad fields
  have inside := Inv32Revert.blockRevert (n+15) t c outer out _ _ ((seqStep _ _ _ _ _ _ _ z).trans ((seqStep _ _ _ _ _ _ _ get).trans
    ((seqStep _ _ _ _ _ _ _ owner).trans (Inv32Revert.stop _ _ _ _ _ _ [(Inv03.Bodies.ret (Inv03.Bodies.num 1)).value] _ fail))))
  have skip : Stmt.eval (n+16) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have param := cleanParamExec (n+15) t c outer "value" val vw rfl (by dsimp [outer,start]; write_param)
  exact ⟨out.popScope.popScope,Inv32Revert.blockRevert _ t c (start r dst val) out.popScope _ _
    ((seqStep _ _ _ _ _ _ _ skip).trans ((seqStep _ _ _ _ _ _ _ param).trans ((seqStep _ _ _ _ _ _ _ skip).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ inside))))⟩
theorem transferRejected (s : State) (src dst val self : Nat) (sv : src<2^160) (dv : dst<2^160) (vw : val<R)
    (err : RevertData) (bad : Rejection s src dst val err) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transfer") (Child.callContext src self) s [.word dst,.word val] =
      some (.reverted s err.untagFixedBytes) := by
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
  obtain ⟨out,ev⟩ := bodyRejected 49983 c r dst val sv dv vw err (by cases bad with | low a b h => exact .low a b h | zero z => exact .zero z) rfl
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [Child.resolve _ _ _ _ _ found frame]
  change f.call? 50000 model.core.table c s [.word dst,.word val] = _
  unfold FunctionDef.call? FunctionDef.call
  rw [beginCall,bd,ev]
  rfl
end Inv39.Transfer
