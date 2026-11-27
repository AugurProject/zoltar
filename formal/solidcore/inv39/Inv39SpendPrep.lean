import Inv39SpendCall
import Inv39TransferCore
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Allowance
def three (r : Runtime) (x y v : Nat) := ((r.pushScope.declareLocal "_ic_arg_0" (.word x)).declareLocal "_ic_arg_1" (.word y)).declareLocal "_ic_arg_2" (.word v)
theorem prepOK (n : Nat) (c : Context) (r : Runtime) (src dst k : String) (x y v : Nat)
    (X : r.lookupLocal? src=some (.word x)) (Y : (r.pushScope.declareLocal "_ic_arg_0" (.word x)).lookupLocal? dst=some (.word y))
    (V : r.lookupLocal? "value"=some (.word v)) (fit : v<R) (done : Runtime)
    (ev : Stmt.eval n model.core.table c (three r x y v) (.internalCall [] k [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"])=pure (.normal done)) :
    Stmt.eval (n+2) model.core.table c r (prep src dst k).value=pure (.normal done.popScope) := by
  let t := model.core.table
  let a := r.pushScope.declareLocal "_ic_arg_0" (.word x)
  let b := a.declareLocal "_ic_arg_1" (.word y)
  have u := Inv32Hoist.declEval n t c r.pushScope "_ic_arg_0" .address (.var src) x
    (Inv32Guards.readWord _ _ _ _ _ (show r.pushScope.lookupLocal? src=some (.word x) from X)) rfl
  have w := Inv32Hoist.declEval n t c a "_ic_arg_1" .address (.var dst) y (Inv32Guards.readWord _ _ _ _ _ Y) rfl
  have z := Inv32Hoist.declEval n t c b "_ic_arg_2" .uint256 (Child.cv "value") v (Child.readClean _ _ _ _ _ fit V) rfl
  have cap := Inv32Internal.capture _ t c (three r x y v) done [] _ ev
  exact Inv32Hoist.block _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ u).trans ((seqStep _ _ _ _ _ _ _ w).trans
    ((seqStep _ _ _ _ _ _ _ z).trans ((seqStep _ _ _ _ _ _ [] cap).trans (show Stmt.evalList (n+1) t c done []=pure (.normal done) by rw [Stmt.evalList])))))
theorem prepSpend (n : Nat) (c : Context) (r : Runtime) (o sp v old : Nat)
    (O : r.lookupLocal? "from"=some (.word o)) (S : r.lookupLocal? "spender"=some (.word sp)) (V : r.lookupLocal? "value"=some (.word v))
    (atSlot : r.state.loadSlot (slot o sp)=old) (oldFit : old<R) (enough : old<R-1 → v≤old) (ow : o<2^160) (sw : sp<2^160)
    (on : old<R-1 → o≠0) (sn : old<R-1 → sp≠0) (fit : v<R) (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ q, Stmt.eval (n+17) model.core.table c r (prep "from" "spender" spendKey).value=pure (.normal q) ∧ q.locals=r.locals ∧
      q.state.storage=(afterSpend r.state o sp old v).storage := by
  obtain ⟨done,ev,locals,storage⟩ := spendCall n c (three r o sp v) o sp old v "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" rfl rfl rfl atSlot oldFit enough ow sw on sn fit fields events
  refine ⟨done.popScope,prepOK (n+15) c r "from" "spender" spendKey o sp v O S V fit _ ev,?_,storage⟩
  change done.locals.drop 1=_
  rw [locals]; rfl
end Inv39.Allowance
