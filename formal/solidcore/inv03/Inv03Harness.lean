import Inv03FeeCall

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes
open Inv32FloorHoist Inv32FloorStart Inv32FloorFastPath Inv32Actions Inv32QuoteExpr
namespace Inv03.Harness
def names := ["questionUnits","supply","minimumRate","netCash","units"]
def setup := Bodies.hoist Bodies.feeKey Bodies.feeRet
  [(a0,Bodies.wvar "questionUnits"),(a1,Bodies.wvar "supply"),(a2,Bodies.wvar "minimumRate"),
   (Fee.a3,Bodies.wvar "netCash"),(Fee.a4,Bodies.wvar "units")]
def shape := Bodies.block (names.map Bodies.param ++ [Stmt_skip,Bodies.block
  [Bodies.decl Bodies.tmp Option_none,setup,Bodies.ret Bodies.copied]])
def args (q s rate net total : Nat) : List Source.Value := [.word q,.word s,.word rate,.word net,.word total]
def frame (q s rate net total : Nat) : Frame :=
  [("questionUnits",.word q),("supply",.word s),("minimumRate",.word rate),
   ("netCash",.word net),("units",.word total),("_ret0",.word 0)]
private def temps (r : Runtime) (out q s rate net total ret : Nat) :=
  (((st3 r Bodies.tmp out q s rate).declareLocal Fee.a3 (.word net)).declareLocal Fee.a4 (.word total)).declareLocal Bodies.feeRet (.word ret)

theorem execute (n : Nat) (c : Context) (r : Runtime) (q s rate net total : Nat)
    (hq : q<R) (hs : s<R) (hr : rate<R) (hn : net<R) (ht : total<R)
    (np : 0<net) (tp : 0<total) (hc : ceilQuot (s*rate) (10^18)<R)
    (scaledFits : total*10^9<R) (hv : rawValue q net total<R) :
    let src := r.withFrame (frame q s rate net total)
    Stmt.eval (n+35) model.core.table c src shape.value =
      pure (.returned src [.word (budget q (ceilQuot (s*rate) (10^18)) net total)]) := by
  let t := model.core.table
  let src := r.withFrame (frame q s rate net total)
  let outer := src.pushScope
  let inner := outer.pushScope
  let v := budget q (ceilQuot (s*rate) (10^18)) net total
  let st := fun out ret => temps inner out q s rate net total ret
  have small : v<R := by
    dsimp only [v,budget]
    split
    · decide
    · exact lt_of_le_of_lt (Nat.sub_le _ _) hq
  have called := Fee.call n c (st 0 0) q s rate net total hq hs hr hn ht np tp hc scaledFits hv rfl rfl rfl rfl rfl
  have write : (st 0 0).assignLocal? Bodies.feeRet (.word v) = some (st 0 v) := by
    dsimp [st,temps,Bodies.feeRet,inner,outer,src,frame,Fee.a3,Fee.a4]
    write_temps
  have cap := Inv32Hoist.takeReturn _ _ _ _ _ _ _ _ _ called write
  have cp : Stmt.evalList (n+32) t c (st 0 v) [.assign (.var Bodies.tmp) (.var Bodies.feeRet)] =
      pure (.normal (st v v)) := by
    apply Inv32Hoist.lastCopy _ _ _ _ _ _ _ 0 v
    all_goals dsimp [st,temps,Bodies.tmp,Inv32CeilFlags.h0,Bodies.feeRet,inner,outer,src,frame,Fee.a3,Inv32CeilHoist.a3,Fee.a4] <;> write_temps
  have step : Stmt.eval (n+33) t c (Inv32OneArg.store inner Bodies.tmp 0) setup.value =
      pure (.normal (Inv32OneArg.store inner Bodies.tmp v)) := by
    apply Inv32Hoist.block _ _ _ _ (st v v)
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+31) t c _ a0 "questionUnits" q hq rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+31) t c _ a1 "supply" s hs rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+31) t c _ a2 "minimumRate" rate hr rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+31) t c _ Fee.a3 "netCash" net hn rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+31) t c _ Fee.a4 "units" total ht rfl)).trans ?_
    exact (seqStep _ _ _ _ _ _ _ (zero (n+31) t c _ Bodies.feeRet)).trans ((seqStep _ _ _ _ _ _ _ cap).trans cp)
  let finish := Inv32OneArg.store inner Bodies.tmp v
  have ret := Inv32CompareValues.retOne (n+32) t c finish (castCopy Bodies.tmp).core v
    (evalFormula (castCopy Bodies.tmp) c finish v (by decide) (castValue _ _ _ _ small rfl))
  have mid := blockReturned (n+33) t c outer finish _ _ ((seqStep _ _ _ _ _ _ _ (zero (n+32) t c inner Bodies.tmp)).trans
    ((seqStep _ _ _ _ _ _ _ step).trans (stop _ _ _ _ _ _ [] _ ret)))
  have a := cleanParamExec (n+33) t c outer "questionUnits" q hq rfl (by dsimp [outer,src,frame]; write_param)
  have b := cleanParamExec (n+33) t c outer "supply" s hs rfl (by dsimp [outer,src,frame]; write_param)
  have e := cleanParamExec (n+33) t c outer "minimumRate" rate hr rfl (by dsimp [outer,src,frame]; write_param)
  have f := cleanParamExec (n+33) t c outer "netCash" net hn rfl (by dsimp [outer,src,frame]; write_param)
  have g := cleanParamExec (n+33) t c outer "units" total ht rfl (by dsimp [outer,src,frame]; write_param)
  have skip : Stmt.eval (n+34) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  apply blockReturned _ _ _ _ outer
  exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ b).trans ((seqStep _ _ _ _ _ _ _ e).trans
    ((seqStep _ _ _ _ _ _ _ f).trans ((seqStep _ _ _ _ _ _ _ g).trans ((seqStep _ _ _ _ _ _ _ skip).trans
    (stop _ _ _ _ _ _ [] _ mid))))))
end Inv03.Harness
