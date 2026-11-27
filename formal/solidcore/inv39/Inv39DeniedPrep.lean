import Inv39DeniedSpendCall
import Inv39SpendPrep
import Inv39TransferCore
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Allowance
theorem prepDenied (n : Nat) (c : Context) (r : Runtime) (src dst k : String) (x y v : Nat)
    (X : r.lookupLocal? src=some (.word x)) (Y : (r.pushScope.declareLocal "_ic_arg_0" (.word x)).lookupLocal? dst=some (.word y))
    (V : r.lookupLocal? "value"=some (.word v)) (fit : v<R) (done : Runtime) (err : RevertData)
    (ev : Stmt.eval n model.core.table c (three r x y v) (.internalCall [] k [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"])=pure (.reverted done err)) :
    Stmt.eval (n+2) model.core.table c r (prep src dst k).value=pure (.reverted done.popScope err) := by
  let t := model.core.table
  let a := r.pushScope.declareLocal "_ic_arg_0" (.word x)
  let b := a.declareLocal "_ic_arg_1" (.word y)
  have u := Inv32Hoist.declEval n t c r.pushScope "_ic_arg_0" .address (.var src) x
    (Inv32Guards.readWord _ _ _ _ _ (show r.pushScope.lookupLocal? src=some (.word x) from X)) rfl
  have w := Inv32Hoist.declEval n t c a "_ic_arg_1" .address (.var dst) y (Inv32Guards.readWord _ _ _ _ _ Y) rfl
  have z := Inv32Hoist.declEval n t c b "_ic_arg_2" .uint256 (Child.cv "value") v (Child.readClean _ _ _ _ _ fit V) rfl
  have cap := Inv32Revert.capture _ t c (three r x y v) done _ [] err ev
  exact Inv32Revert.blockRevert _ t c r done _ err ((seqStep _ _ _ _ _ _ _ u).trans ((seqStep _ _ _ _ _ _ _ w).trans
    ((seqStep _ _ _ _ _ _ _ z).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ cap))))
end Inv39.Allowance
