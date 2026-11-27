import Inv39ApprovalShape
import Inv39ApprovalHoist
import Inv39DeniedHoist
import Inv39SpendBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
/-- The three-argument wrapper enables the generated Approval event on every successful path. -/
theorem approve3Body (n : Nat) (c : Context) (r : Runtime) (o sp v : Nat) (ow : o<2^160) (sw : sp<2^160) (fit : v<R)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    let start := r.withFrame (args3 o sp v)
    ∃ q, (Stmt.eval (n+10) model.core.table c start approve3Shape.value=pure (.reverted q (zeroApproval o))) ∨
      (Stmt.eval (n+10) model.core.table c start approve3Shape.value=pure (.normal q) ∧ q.state.storage=(r.state.storeSlot (slot o sp) v).storage) := by
  let t := model.core.table
  let start := r.withFrame (args3 o sp v)
  let outer := start.pushScope
  let inner := outer.pushScope
  have val (s : Runtime) (V : s.lookupLocal? "value"=some (.word v)) : (Inv03.Bodies.wvar "value").value.eval c s=pure (.word v,s) :=
    Child.readClean _ _ _ _ _ fit V
  have sk : Stmt.eval (n+9) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have prm := cleanParamExec (n+8) t c outer "value" v fit rfl (by dsimp [outer,start,args3]; write_param)
  by_cases bad : o=0 ∨ sp=0
  · obtain ⟨q,call⟩ := deniedHoist n c inner o sp v true (Inv03.Bodies.wvar "value") rfl rfl (val _ rfl) (lt_trans ow (by decide)) bad fit
    have grp := Inv32Revert.blockRevert _ t c outer q _ _ (Inv32Revert.stop _ _ _ _ _ _ [] _ call)
    refine ⟨q.popScope.popScope,.inl ?_⟩
    exact Inv32Revert.blockRevert _ t c start q.popScope _ _ ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans
      ((seqStep _ _ _ _ _ _ _ prm).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ grp))))
  · obtain ⟨q,call,_,storage⟩ := hoistApprove n c inner o sp v true (Inv03.Bodies.wvar "value") rfl rfl (val _ rfl) ow sw
      (fun z=>bad (.inl z)) (fun z=>bad (.inr z)) fit fields events
    have grp := Inv32Blocks.one (n+8) t c outer q _ call
    refine ⟨q.popScope.popScope,.inr ⟨?_,storage⟩⟩
    apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ prm).trans
      ((seqStep _ _ _ _ _ _ [] grp).trans (show Stmt.evalList (n+9) t c q.popScope []=pure (.normal q.popScope) by rw [Stmt.evalList]))))
end Inv39.Allowance
