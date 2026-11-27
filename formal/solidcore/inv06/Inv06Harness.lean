import Inv06CashCall
import CheckedWordCall
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes
open Inv32FloorHoist Inv32FloorStart Inv32FloorFastPath Inv32Actions Inv32QuoteExpr Inv03
namespace Inv06.Harness
def names := ["cash","units","remainder","burned"]
def dest := "_ret___library_SecurityPoolSettlementMath_cashForUnits_0"
def setup := Bodies.hoist Shapes.cashKey dest
  [(a0,Bodies.wvar "cash"),(a1,Bodies.wvar "units"),(a2,Bodies.wvar "remainder"),(Inv32CeilHoist.a3,Bodies.wvar "burned")]
def shape := Bodies.block (names.map Bodies.param ++ [Stmt_skip,Bodies.block
  [Bodies.decl Bodies.tmp Option_none,setup,Bodies.ret Bodies.copied]])
def args (cash units carry burned : Nat) : List Source.Value := [.word cash,.word units,.word carry,.word burned]
theorem execute (f : Nat) (c : Context) (r : Runtime) (cash units carry burned : Nat)
    (cap : cash<2^128) (book : units<2^128) (balance : burned≤units) (le : carry≤cash*10^9) :
    let src := r.withFrame (Cash.frame cash units carry burned)
    Stmt.eval (f+37) model.core.table c src shape.value =
      pure (.returned src [.word (Cash.payment cash units carry burned)]) := by
  let t := model.core.table
  let src := r.withFrame (Cash.frame cash units carry burned)
  let outer := src.pushScope
  let inner := outer.pushScope
  let v := Cash.payment cash units carry burned
  have cashWord : cash<R := lt_trans cap (by decide)
  have unitsWord : units<R := lt_trans book (by decide)
  have carryWord := lt_of_le_of_lt le (lt_trans (Nat.mul_lt_mul_of_pos_right cap (by decide : 0<10^9)) (by decide : 2^128*10^9<R))
  have burnedWord := lt_of_le_of_lt balance unitsWord
  have small := lt_of_le_of_lt (Cash.paymentBound cash units carry burned balance) cashWord
  have ins : Inputs c inner Bodies.tmp (w "cash").core (w "units").core (w "remainder").core cash units carry :=
    ⟨Inv32Guards.clean _ _ _ _ _ cashWord (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ unitsWord (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ carryWord (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  let st := Hoist.frame inner dest 0 cash units carry burned 0
  have called := Cash.call f c st a0 a1 a2 Inv32CeilHoist.a3 [dest] cash units carry burned cap book balance le rfl rfl rfl rfl
  have step := Hoist.run (f+32) t c inner Shapes.cashKey dest _ _ _ (w "burned").core cash units carry burned v ins
    (Inv32Guards.clean _ _ _ _ _ burnedWord (Inv32Guards.readWord _ _ _ _ _ rfl)) (by decide) called
  let finish := Inv32OneArg.store inner Bodies.tmp v
  have ret := Inv32CompareValues.retOne (f+34) t c finish (castCopy Bodies.tmp).core v
    (evalFormula (castCopy Bodies.tmp) c finish v (by decide) (castValue _ _ _ _ small rfl))
  have mid := blockReturned (f+35) t c outer finish _ _ ((seqStep _ _ _ _ _ _ _ (zero (f+34) t c inner Bodies.tmp)).trans
    ((seqStep _ _ _ _ _ _ _ step).trans (stop _ _ _ _ _ _ [] _ ret)))
  have a := cleanParamExec (f+35) t c outer "cash" cash cashWord rfl (by dsimp [outer,src,Cash.frame]; write_param)
  have b := cleanParamExec (f+35) t c outer "units" units unitsWord rfl (by dsimp [outer,src,Cash.frame]; write_param)
  have e := cleanParamExec (f+35) t c outer "remainder" carry carryWord rfl (by dsimp [outer,src,Cash.frame]; write_param)
  have g := cleanParamExec (f+35) t c outer "burned" burned burnedWord rfl (by dsimp [outer,src,Cash.frame]; write_param)
  have sk : Stmt.eval (f+36) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  apply blockReturned _ _ _ _ outer
  exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ b).trans ((seqStep _ _ _ _ _ _ _ e).trans
    ((seqStep _ _ _ _ _ _ _ g).trans ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ mid)))))
end Inv06.Harness
