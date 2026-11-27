import Inv39Fetch
import Inv39GuardNumbers
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Child
theorem guardRun (n : Nat) (c : Context) (r : Runtime) (issued val cap : Nat)
    (quantity : r.lookupLocal? "valueAttoRep"=some (.word val)) (atIssued : r.state.loadSlot circulating.slot=issued)
    (atCap : r.state.loadSlot theoretical.slot=cap) (capFit : cap<R) (allowed : issued+val≤cap)
    (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (n+7) model.core.table c r mintGuard.value = pure (.normal r) := by
  let t := model.core.table
  let one := stateTmp r issued
  let two := one.declareLocal "#view1586" (.word issued)
  let three := two.declareLocal "#operand1587" (.word val)
  let four := three.declareLocal "#operand1588" (.word (issued+val))
  let five := four.declareLocal "#operand1589" (.word cap)
  have fit := lt_of_le_of_lt allowed capFit
  have zero := Inv32FloorStart.zero (n+5) t c r.pushScope tmp
  have get := fetchRun n c r issued fields atIssued (by omega)
  have dv := Inv32Hoist.declEval (n+5) t c one "#view1586" .uint256 (cv tmp) issued
    (readClean _ c one tmp issued (by omega) rfl) rfl
  have da := Inv32Hoist.declEval (n+5) t c two "#operand1587" .uint256 (cv "valueAttoRep") val
    (readClean _ c two "valueAttoRep" val (by omega) quantity) rfl
  have ds := Inv32Hoist.declEval (n+5) t c three "#operand1588" .uint256 sumExpr (issued+val)
    (sumRead _ _ _ _ _ fit rfl rfl) rfl
  have slot : WordField.stored four.state (Getter.field .ceiling)=cap := atCap
  have cvCap := Getter.expression .ceiling c four 2 fields (slot ▸ capFit)
  rw [slot] at cvCap
  have dc := Inv32Hoist.declEval (n+5) t c four "#operand1589" .uint256 (Getter.retExpr .ceiling).value cap
    cvCap rfl
  have cond : capExpr.eval c five = pure (.word (boolWord true),five) := by
    simpa only [decide_eq_true allowed] using capRead _ c five (issued+val) cap fit capFit rfl rfl
  have check := Inv32QuoteGuard.requireEval (n+5) t c five capExpr true "Mint exceeds theoretical supply" cond
  have endList : Stmt.evalList (n+6) t c five [] = pure (.normal five) := by rw [Stmt.evalList]
  exact Inv32Hoist.block _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ zero).trans ((seqStep _ _ _ _ _ _ _ get).trans ((seqStep _ _ _ _ _ _ _ dv).trans
    ((seqStep _ _ _ _ _ _ _ da).trans ((seqStep _ _ _ _ _ _ _ ds).trans ((seqStep _ _ _ _ _ _ _ dc).trans ((seqStep _ _ _ _ _ _ [] check).trans endList)))))))
end Inv39.Child
