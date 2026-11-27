import Inv04CashCall
import CheckedWordCall
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes
open Inv32FloorHoist Inv32FloorStart Inv32FloorFastPath Inv32Actions Inv32QuoteExpr Inv03
namespace Inv04.Harness
def names := ["units","numerator","denominator","remainder"]
def dest := "_ret___library_SecurityPoolSettlementMath_requiredCash_0"
def setup := Bodies.hoist Shapes.requiredKey dest
  [(a0,Bodies.wvar "units"),(a1,Bodies.wvar "numerator"),(a2,Bodies.wvar "denominator"),(Inv32CeilHoist.a3,Bodies.wvar "remainder")]
def shape := Bodies.block (names.map Bodies.param ++ [Stmt_skip,Bodies.block
  [Bodies.decl Bodies.tmp Option_none,setup,Bodies.ret Bodies.copied]])
def args (u n d rem : Nat) : List Source.Value := [.word u,.word n,.word d,.word rem]
theorem execute (f : Nat) (c : Context) (r : Runtime) (u n d rem : Nat)
    (hu : u<R) (hn : n<R) (hd : d<R) (hr : rem<R) (hp : 0<d) (fits : ceilQuot (u*n) d+rem<R) :
    let src := r.withFrame (Cash.frame u n d rem)
    Stmt.eval (f+28) model.core.table c src shape.value =
      pure (.returned src [.word (ceilQuot (ceilQuot (u*n) d+rem) (10^9))]) := by
  let t := model.core.table
  let src := r.withFrame (Cash.frame u n d rem)
  let outer := src.pushScope
  let inner := outer.pushScope
  let x := ceilQuot (u*n) d+rem
  let v := ceilQuot x (10^9)
  have small : v<R := lt_of_le_of_lt ((ceil_le x (10^9) x (by decide)).mpr (Nat.le_mul_of_pos_right _ (by decide))) fits
  have ins : Inputs c inner Bodies.tmp (w "units").core (w "numerator").core (w "denominator").core u n d :=
    ⟨Inv32Guards.clean _ _ _ _ _ hu (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hn (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hd (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  let st := Hoist.frame inner dest 0 u n d rem 0
  have called := Cash.call f c st a0 a1 a2 Inv32CeilHoist.a3 [dest] u n d rem hu hn hd hr hp fits rfl rfl rfl rfl
  have step := Hoist.run (f+23) t c inner Shapes.requiredKey dest _ _ _ (w "remainder").core u n d rem v ins
    (Inv32Guards.clean _ _ _ _ _ hr (Inv32Guards.readWord _ _ _ _ _ rfl)) (by decide) called
  let finish := Inv32OneArg.store inner Bodies.tmp v
  have ret := Inv32CompareValues.retOne (f+25) t c finish (castCopy Bodies.tmp).core v
    (evalFormula (castCopy Bodies.tmp) c finish v (by decide) (castValue _ _ _ _ small rfl))
  have mid := blockReturned (f+26) t c outer finish _ _ ((seqStep _ _ _ _ _ _ _ (zero (f+25) t c inner Bodies.tmp)).trans
    ((seqStep _ _ _ _ _ _ _ step).trans (stop _ _ _ _ _ _ [] _ ret)))
  have a := cleanParamExec (f+26) t c outer "units" u hu rfl (by dsimp [outer,src,Cash.frame]; write_param)
  have b := cleanParamExec (f+26) t c outer "numerator" n hn rfl (by dsimp [outer,src,Cash.frame]; write_param)
  have e := cleanParamExec (f+26) t c outer "denominator" d hd rfl (by dsimp [outer,src,Cash.frame]; write_param)
  have g := cleanParamExec (f+26) t c outer "remainder" rem hr rfl (by dsimp [outer,src,Cash.frame]; write_param)
  have sk : Stmt.eval (f+27) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  apply blockReturned _ _ _ _ outer
  exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ b).trans ((seqStep _ _ _ _ _ _ _ e).trans
    ((seqStep _ _ _ _ _ _ _ g).trans ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ mid)))))
end Inv04.Harness
