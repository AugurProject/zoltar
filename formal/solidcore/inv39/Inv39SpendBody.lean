import Inv39SpendBranch
import Inv39SpendFetch
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
def args3 (o sp v : Nat) : Source.Frame := [("owner",.word o),("spender",.word sp),("value",.word v)]
theorem spendBody (n : Nat) (c : Context) (r : Runtime) (o sp old v : Nat) (ow : o<2^160) (sw : sp<2^160) (on : old<R-1 → o≠0)
    (sn : old<R-1 → sp≠0) (atSlot : r.state.loadSlot (slot o sp)=old) (fit : old<R) (valueFit : v<R) (enough : old<R-1 → v≤old)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    let start := r.withFrame (args3 o sp v)
    ∃ q, Stmt.eval (n+14) model.core.table c start spendShape.value=pure (.normal q) ∧ q.locals=start.locals ∧
      q.state.storage=(afterSpend r.state o sp old v).storage := by
  let t := model.core.table
  let start := r.withFrame (args3 o sp v)
  let outer := start.pushScope
  let afterGet := hoist outer old
  let current := afterGet.declareLocal "currentAllowance" (.word old)
  have zero := Inv32FloorStart.zero (n+11) t c outer.pushScope tmp
  have get := getRun (n+6) c outer o sp old rfl rfl fields atSlot fit
  have decl := Inv32Hoist.declEval (n+11) t c afterGet "currentAllowance" .uint256 (Child.cv tmp) old
    (Child.readClean _ c afterGet tmp old fit rfl) rfl
  obtain ⟨done,spent,locals,storage⟩ := spendIf n c current o sp old v rfl rfl rfl rfl ow sw on sn fit enough fields events
  have block := Inv32Hoist.block (n+12) t c outer done _ ((seqStep _ _ _ _ _ _ _ zero).trans ((seqStep _ _ _ _ _ _ _ get).trans
    ((seqStep _ _ _ _ _ _ _ decl).trans ((seqStep _ _ _ _ _ _ [] spent).trans (show Stmt.evalList (n+12) t c done []=pure (.normal done) by rw [Stmt.evalList])))))
  have sk : Stmt.eval (n+13) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have prm := cleanParamExec (n+12) t c outer "value" v valueFit rfl (by dsimp [outer,start,args3]; write_param)
  refine ⟨done.popScope.popScope,?_,?_,storage⟩
  · apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ prm).trans
      ((seqStep _ _ _ _ _ _ [] block).trans (show Stmt.evalList (n+13) t c done.popScope []=pure (.normal done.popScope) by rw [Stmt.evalList]))))
  · change (done.locals.drop 1).drop 1=_; rw [locals]; rfl
end Inv39.Allowance
