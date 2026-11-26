import Inv39SpendDenied
import Inv39SpendBody
import Inv39SpendFetch
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
theorem deniedSpendBody (n : Nat) (c : Context) (r : Runtime) (o sp old v : Nat) (ow : o<R) (atSlot : r.state.loadSlot (slot o sp)=old)
    (bounded : old<R-1) (vf : v<R) (err : RevertData) (bad : ChargeDenied o sp old v err)
    (fields : c.storageFields=model.core.context.storageFields) :
    ∃ q, Stmt.eval (n+14) model.core.table c (r.withFrame (args3 o sp v)) spendShape.value=pure (.reverted q err) := by
  have fit : old<R := by omega
  let t := model.core.table
  let start := r.withFrame (args3 o sp v)
  let outer := start.pushScope
  let afterGet := hoist outer old
  let current := afterGet.declareLocal "currentAllowance" (.word old)
  have zero := Inv32FloorStart.zero (n+11) t c outer.pushScope tmp
  have get := getRun (n+6) c outer o sp old rfl rfl fields atSlot fit
  have decl := Inv32Hoist.declEval (n+11) t c afterGet "currentAllowance" .uint256 (Child.cv tmp) old
    (Child.readClean _ c afterGet tmp old fit rfl) rfl
  obtain ⟨done,spent⟩ := spendIfDenied n c current o sp old v rfl rfl rfl rfl ow bounded vf err bad
  have block := Inv32Revert.blockRevert (n+12) t c outer done _ err ((seqStep _ _ _ _ _ _ _ zero).trans ((seqStep _ _ _ _ _ _ _ get).trans
    ((seqStep _ _ _ _ _ _ _ decl).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ spent))))
  have sk : Stmt.eval (n+13) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have prm := cleanParamExec (n+12) t c outer "value" v vf rfl (by dsimp [outer,start,args3]; write_param)
  exact ⟨done.popScope.popScope,Inv32Revert.blockRevert _ t c start done.popScope _ err ((seqStep _ _ _ _ _ _ _ sk).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ prm).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ block))))⟩
end Inv39.Allowance
