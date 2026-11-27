import Inv39DeniedPrep
import Inv39DelegateBody
import Inv39TransferRejected
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
inductive Failure (s : State) (x y sp old v : Nat) : RevertData → Prop where
  | charge (bounded : old<R-1) {err} (bad : ChargeDenied x sp old v err) : Failure s x y sp old v err
  | move (allow : old<R-1 → v≤old) (owner : old<R-1 → x≠0) (spender : old<R-1 → sp≠0)
      {err} (bad : Transfer.Rejection (afterSpend s x sp old v) x y v err) : Failure s x y sp old v err
theorem denyInner (n : Nat) (c : Context) (r : Runtime) (x y v old : Nat) (O : r.lookupLocal? "from"=some (.word x)) (D : r.lookupLocal? "to"=some (.word y))
    (S : r.lookupLocal? "spender"=some (.word c.sender)) (V : r.lookupLocal? "value"=some (.word v))
    (atSlot : r.state.loadSlot (slot x c.sender)=old) (oldFit : old<R) (vf : v<R) (xw : x<2^160) (yw : y<2^160) (sw : c.sender<2^160)
    (err : RevertData) (why : Failure r.state x y c.sender old v err) (fields : c.storageFields=model.core.context.storageFields)
    (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ q, Stmt.evalList (n+17) model.core.table c r [(prep "from" "spender" spendKey).value,
      (prep "from" "to" (Motion.key .transfer)).value,(Inv03.Bodies.ret (Inv03.Bodies.num 1)).value]=pure (.reverted q err) := by
  cases why with
  | charge bounded bad =>
    obtain ⟨q,fail⟩ := deniedSpendCall n c (three r x c.sender v) x c.sender old v "_ic_arg_0" "_ic_arg_1" "_ic_arg_2"
      rfl rfl rfl atSlot (lt_trans xw (by decide)) bounded vf err bad fields
    have step := prepDenied (n+15) c r "from" "spender" spendKey x c.sender v O S V vf q err fail
    exact ⟨q.popScope,Inv32Revert.stop _ _ _ _ _ _ _ _ step⟩
  | move allowed owner spender bad =>
    obtain ⟨charged,paid,locals,storage⟩ := prepSpend n c r x c.sender v old O S V atSlot oldFit allowed xw sw owner spender vf fields events
    have ls (name : String) : charged.lookupLocal? name=r.lookupLocal? name := by simp [Runtime.lookupLocal?,locals]
    let ready := three charged x y v
    have call : ∃ q, Stmt.eval (n+15) model.core.table c ready (.internalCall [] (Motion.key .transfer) (Motion.exprs .transfer "_ic_arg_0" "_ic_arg_1" "_ic_arg_2"))=pure (.reverted q err) := by
      cases bad with
      | zero z => exact Motion.zeroCall (n+2) c ready .transfer x y v _ _ _ rfl (by intro; rfl) rfl xw yw vf z
      | low xn yn low =>
        have lacks : ready.state.loadSlot (balanceSlot x)<v := by
          change charged.state.loadSlot _<v
          simpa only [State.loadSlot,storage] using low
        exact Motion.rejectedCall (n+2) c ready .transfer x y v _ _ _ rfl (by intro; rfl) rfl xw yw vf xn (fun _ => yn) (by decide) lacks fields
    obtain ⟨q,fail⟩ := call
    have step := prepDenied (n+15) c charged "from" "to" (Motion.key .transfer) x y v ((ls _).trans O) ((ls _).trans D) ((ls _).trans V) vf _ _ fail
    exact ⟨q.popScope,(seqStep _ _ _ _ _ _ _ paid).trans (Inv32Revert.stop _ _ _ _ _ _ _ _ step)⟩
end Inv39.Allowance
