import Inv39DirectApproveCall
import Inv39DeniedPrep
import Inv39PublicTransfer
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
def directStart (r : Runtime) (sp v : Nat) := r.withFrame [("spender",.word sp),("value",.word v),("_ret0",.word 0)]
theorem directBody (n : Nat) (c : Context) (r : Runtime) (sp v : Nat) (ow : c.sender<2^160) (sw : sp<2^160) (fit : v<R)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    let evaluation := Stmt.eval (n+15) model.core.table c (directStart r sp v) directShape.value
    ∃ q, evaluation=pure (.reverted q (zeroApproval c.sender)) ∨
      (evaluation=pure (.returned q [.word 1]) ∧ q.state.storage=(r.state.storeSlot (slot c.sender sp) v).storage) := by
  let t := model.core.table
  let enter := directStart r sp v
  let outer := enter.pushScope
  let fetched := Child.stateTmp outer c.sender
  let owned := fetched.declareLocal "owner" (.word c.sender)
  let ready := three owned c.sender sp v
  have z := Transfer.zeroAddress (n+12) t c outer.pushScope Transfer.tmp
  have get := Transfer.fetchRun (n+7) c outer
  have own := Inv32Hoist.declEval (n+12) t c fetched "owner" .address (.var Transfer.tmp) c.sender (Inv32Guards.readWord _ _ _ _ _ rfl) rfl
  have sk : Stmt.eval (n+14) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have prm := cleanParamExec (n+13) t c outer "value" v fit rfl (by dsimp [outer,enter,directStart]; write_param)
  obtain ⟨done,fail|⟨ok,_,store⟩⟩ := approve3Call n c ready c.sender sp v "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" rfl rfl rfl ow sw fit fields events
  · have act := prepDenied (n+11) c owned "owner" "spender" approve3Key c.sender sp v rfl rfl rfl fit _ _ fail
    have blk := Inv32Revert.blockRevert (n+13) t c outer done.popScope _ _ ((seqStep _ _ _ _ _ _ _ z).trans ((seqStep _ _ _ _ _ _ _ get).trans
      ((seqStep _ _ _ _ _ _ _ own).trans (Inv32Revert.stop _ _ _ _ _ _ [(Inv03.Bodies.ret (Inv03.Bodies.num 1)).value] _ act))))
    refine ⟨done.popScope.popScope.popScope,.inl ?_⟩
    exact Inv32Revert.blockRevert _ t c enter done.popScope.popScope _ _ ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ prm).trans
      ((seqStep _ _ _ _ _ _ _ sk).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ blk))))
  · have act := prepOK (n+11) c owned "owner" "spender" approve3Key c.sender sp v rfl rfl rfl fit _ ok
    have ret := Transfer.returns (.word 1) c done.popScope 1 t (n+12) rfl
    have blk := blockReturned (n+13) t c outer done.popScope _ _ ((seqStep _ _ _ _ _ _ _ z).trans ((seqStep _ _ _ _ _ _ _ get).trans
      ((seqStep _ _ _ _ _ _ _ own).trans ((seqStep _ _ _ _ _ _ _ act).trans (stop _ _ _ _ _ _ [] _ ret)))))
    refine ⟨done.popScope.popScope.popScope,.inr ⟨?_,store⟩⟩
    apply blockReturned
    exact (seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ prm).trans ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ blk)))
end Inv39.Allowance
