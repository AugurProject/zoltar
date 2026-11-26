import Inv39ApproveCall
import Inv39SpendShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Allowance
theorem hoistApprove (n : Nat) (c : Context) (r : Runtime) (o sp v : Nat) (f : Bool) (expr : Inv32Shapes.Pattern Source.Expr)
    (O : r.lookupLocal? "owner"=some (.word o)) (S : r.lookupLocal? "spender"=some (.word sp))
    (value : let a := r.pushScope.declareLocal "_ic_arg_0" (.word o); let b := a.declareLocal "_ic_arg_1" (.word sp)
             expr.value.eval c b=pure (.word v,b)) (ow : o<2^160) (sw : sp<2^160) (on : o≠0) (sn : sp≠0) (fit : v<R)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ q, Stmt.eval (n+8) model.core.table c r (approvedCall expr (Inv03.Bodies.num (boolWord f))).value=pure (.normal q) ∧
      q.locals=r.locals ∧ q.state.storage=(r.state.storeSlot (slot o sp) v).storage := by
  let t := model.core.table
  let a := r.pushScope.declareLocal "_ic_arg_0" (.word o)
  let b := a.declareLocal "_ic_arg_1" (.word sp)
  let d := b.declareLocal "_ic_arg_2" (.word v)
  let e := d.declareLocal "_ic_arg_3" (.word (boolWord f))
  have owner := Inv32Hoist.declEval (n+6) t c r.pushScope "_ic_arg_0" .address (.var "owner") o (Inv32Guards.readWord _ _ _ _ _ O) rfl
  have spender := Inv32Hoist.declEval (n+6) t c a "_ic_arg_1" .address (.var "spender") sp (Inv32Guards.readWord _ _ _ _ _ S) rfl
  have qty := Inv32Hoist.declEval (n+6) t c b "_ic_arg_2" .uint256 _ v value rfl
  have flag := Inv32Hoist.declEval (n+6) t c d "_ic_arg_3" .bool (.word (boolWord f)) (boolWord f) (by cases f <;> rfl) (by cases f <;> rfl)
  obtain ⟨done,call,locals,storage⟩ := approveCall n c e o sp v f "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" "_ic_arg_3" rfl rfl rfl rfl ow sw on sn fit fields events
  have cap := Inv32Internal.capture _ t c e done [] _ call
  refine ⟨done.popScope,?_,?_,storage⟩
  · apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ owner).trans ((seqStep _ _ _ _ _ _ _ spender).trans ((seqStep _ _ _ _ _ _ _ qty).trans
      ((seqStep _ _ _ _ _ _ _ flag).trans ((seqStep _ _ _ _ _ _ [] cap).trans (show Stmt.evalList (n+7) t c done []=pure (.normal done) by rw [Stmt.evalList])))))
  · change done.locals.drop 1=_
    rw [locals]; rfl
end Inv39.Allowance
