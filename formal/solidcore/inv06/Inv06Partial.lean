import Inv06NetCall
import Inv03FeeSteps
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath Inv32QuoteExpr Inv32Actions Inv03
namespace Inv06.Cash
def frame (cash units rem b : Nat) : Frame := [("cash",.word cash),("units",.word units),("remainder",.word rem),("burned",.word b),("_ret0",.word 0)]
def raw := Inv03.Bodies.call4 Bodies.rawKey Bodies.rawRet (Bodies.wvar "burned") (Bodies.wvar Shapes.viewName) (Bodies.wvar "units") (Bodies.enumWord 0)
theorem withinCash (cash units rem b : Nat) (balance : b≤units) :
    rawValue b (cash*10^9-rem) units ≤ cash := by
  apply Nat.div_le_of_le_mul
  calc
    b*(cash*10^9-rem) ≤ units*(cash*10^9) := Nat.mul_le_mul balance (Nat.sub_le _ _)
    _ = units*10^9*cash := by ac_rfl

theorem partialRun (f : Nat) (c : Context) (r : Runtime) (cash units rem b : Nat)
    (cap : cash<2^128) (book : units<2^128) (up : 0<units) (balance : b≤units) (le : rem≤cash*10^9) :
    let inner := (r.withFrame (frame cash units rem b)).pushScope.pushScope
    Stmt.eval (f+28) Inv03.model.core.table c inner Shapes.partialBody.value =
      pure (.returned inner [.word (rawValue b (cash*10^9-rem) units)]) := by
  let t := Inv03.model.core.table
  let inner := (r.withFrame (frame cash units rem b)).pushScope.pushScope
  let work := inner.pushScope
  let net := cash*10^9-rem
  let val := rawValue b net units
  let got := Inv32OneArg.store work Bodies.tmp net
  let saved := got.declareLocal Shapes.viewName (.word net)
  let final := Inv32OneArg.store saved Bodies.tmp val
  have hu : units<R := lt_trans book (by decide)
  have hb := lt_of_le_of_lt balance hu
  have hn : net<R := lt_of_le_of_lt (Nat.sub_le _ _) (lt_trans (Nat.mul_lt_mul_of_pos_right cap (by decide : 0<10^9)) (by decide))
  have scaled : units*10^9<R := lt_trans (Nat.mul_lt_mul_of_pos_right book (by decide : 0<10^9)) (by decide)
  have small : val<R := lt_of_le_of_lt (withinCash cash units rem b balance) (lt_trans cap (by decide))
  have first := Net.hoist (f+20) c work cash rem cap le rfl rfl
  have save := Inv32Temps.temp (f+26) t c got Shapes.viewName Bodies.tmp net hn rfl
  let st := Hoist.frame saved Bodies.rawRet 0 b net units 0 0
  have args : Inv32FloorHoist.Inputs c saved Bodies.tmp (w "burned").core (w Shapes.viewName).core (w "units").core b net units :=
    ⟨Inv32Guards.clean _ _ _ _ _ hb (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hn (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hu (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have second := Hoist.run (f+24) t c saved Bodies.rawKey Bodies.rawRet _ _ _ _ b net units 0 val args
    (enumArg c _ false) (by decide) (rawCall f c st _ _ _ _ _ b net units hb hn hu up scaled small rfl rfl rfl rfl)
  have ret := Inv32CompareValues.retOne (f+26) t c final (w Bodies.tmp).core val
    (Inv32Guards.clean _ _ _ _ _ small (Inv32Guards.readWord _ _ _ _ _ rfl))
  apply blockReturned _ t c inner final
  exact (seqStep _ _ _ _ _ _ _ (zero (f+26) t c work Bodies.tmp)).trans ((seqStep _ _ _ _ _ _ _ first).trans
    ((seqStep _ _ _ _ _ _ _ save).trans ((seqStep _ _ _ _ _ _ _ (zero (f+26) t c saved Bodies.tmp)).trans
      ((seqStep _ _ _ _ _ _ _ second).trans (stop _ _ _ _ _ _ [] _ ret)))))
end Inv06.Cash
