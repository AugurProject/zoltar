import Inv32RatioCall
open Inv32FloorHoist SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Scalar Inv32QuoteExpr
namespace Inv32ForwardSteps
abbrev flag := "_sol_hoist_0"
abbrev ratioRet := "_ret___library_TwoWayConstantProductMath__ratioOfSum_0"
def frm (x y g f out paid : Nat) : Frame := [("reserveIn",.word x),("reserveOut",.word y),("amountIn",.word g),
  ("feeBps",.word f),("amountOut",.word out),("feeAmount",.word paid)]
def base (r : Runtime) (x y g f out paid : Nat) := (r.withFrame (frm x y g f out paid)).pushScope.pushScope
def withNet (root : Runtime) (net : Nat) := (Inv32OneArg.store root flag net).declareLocal "netInput" (.word net)
def after (r : Runtime) (x y g f net q out paid : Nat) := Inv32OneArg.store (withNet (base r x y g f out paid) net) flag q
def feeRhs := nonnegativeSub bps (w "feeBps")
def floor := Inv32FloorHoist.code flag (w "amountIn").core feeRhs.core bps.core
def declareNet := Stmt.varDecl .uint256 "netInput" (some (castCopy flag).core)
def requirePositive (s msg : String) := Stmt.requireStmt (positive s).core (some msg)
def ratioCap := Stmt.captureReturn [ratioRet] (.internalCall [ratioRet] Inv32Bodies.Ratio.key Inv32FloorHoist.argv)
def ratio := Stmt.block [Inv32FloorStart.temp Inv32FloorHoist.a0 "reserveOut",Inv32FloorStart.temp Inv32FloorHoist.a1 "netInput",
  Inv32FloorStart.temp Inv32FloorHoist.a2 "reserveIn",.varDecl .uint256 ratioRet none,ratioCap,.assign (.var flag) (.var ratioRet)]
def recordOut := Stmt.assign (.var "amountOut") (w flag).core
def guardOut := Stmt.requireStmt (.binary .boolAnd (positive "amountOut").core (smaller "amountOut" "reserveOut").core) (some "Insufficient output")
def recordFee := Stmt.assign (.var "feeAmount") (nonnegativeSub (w "amountIn") (w "netInput")).core
def zero := Stmt.varDecl .uint256 flag none
def ss := match Inv32Bodies.Forward.body with | .block [_,_,_,_,_,_,.block xs] => xs | _ => []
theorem shape : ss = [Inv32Guards.reservesGuard,requirePositive "amountIn" "Input is zero",Inv32QuoteGuard.fee,
    zero,floor,declareNet,requirePositive "netInput" "Net input is zero",zero,ratio,recordOut,guardOut,recordFee] := by rfl
theorem netBound (g f : Nat) : Inv32.netInput g f ≤ g := by
  unfold Inv32.netInput
  exact le_trans (Nat.div_le_div_right (Nat.mul_le_mul_left g (Nat.sub_le Inv32.bps f))) (le_of_eq (Nat.mul_div_cancel _ (by decide)))
theorem floorExec (n : Nat) (c : Context) (r : Runtime) (x y g f : Nat) (hg : g<R) (hf : f<R) (fb : f<10000) :
    let root := base r x y g f 0 0
    Stmt.eval (n+15) Inv32Dispatch.model.core.table c (Inv32OneArg.store root flag 0) floor =
    pure (.normal (Inv32OneArg.store root flag (Inv32.netInput g f))) := by
  let rt := base r x y g f 0 0
  have sm : 10000-f<R := lt_of_le_of_lt (Nat.sub_le _ _) (by decide)
  have valid := Inv32FloorHoist.success n c rt flag (w "amountIn").core feeRhs.core bps.core g (10000-f) 10000 hg sm (by decide) (by decide)
    (lt_of_le_of_lt (netBound g f) hg)
  apply valid _ (by decide) (by decide) (by decide) (by decide)
  refine ⟨evalFormula (w "amountIn") _ _ _ (by decide) (Inv32InverseSteps.capRead _ _ _ _ hg rfl),?_,
    evalFormula bps _ _ 10000 (by decide) (bpsValue _ _)⟩
  exact evalFormula feeRhs _ _ _ (by decide) (subValue _ _ _ _ 10000 f (by decide) hf (Nat.le_of_lt fb) (bpsValue _ _)
    (Inv32InverseSteps.capRead c _ "feeBps" f hf rfl))
theorem ratioExec (n : Nat) (c : Context) (r : Runtime) (x y g f net : Nat) (hx : x<R) (hy : y<R) (hn : net<R) (pos : 0<x+net) :
    let rt := withNet (base r x y g f 0 0) net
    Stmt.eval (n+278) Inv32Dispatch.model.core.table c (Inv32OneArg.store rt flag 0) ratio =
      pure (.normal (Inv32OneArg.store rt flag (Inv32.ratio y net x))) := by
  let t := Inv32Dispatch.model.core.table
  let rt := withNet (base r x y g f 0 0) net
  let st := fun o v => (Inv32FloorHoist.st3 rt flag o y net x).declareLocal ratioRet (.word v)
  let q := Inv32RatioLoop.answer y net x
  have A := Inv32Temps.temp (n+276) t c (Inv32FloorHoist.start rt flag 0) Inv32FloorHoist.a0 "reserveOut" y hy rfl
  have B := Inv32Temps.temp (n+276) t c (Inv32FloorHoist.st1 rt flag 0 y) Inv32FloorHoist.a1 "netInput" net hn rfl
  have C := Inv32Temps.temp (n+276) t c (Inv32FloorHoist.st2 rt flag 0 y net) Inv32FloorHoist.a2 "reserveIn" x hx rfl
  have Z := Inv32FloorStart.zero (n+276) t c (Inv32FloorHoist.st3 rt flag 0 y net x) ratioRet
  have call := Inv32RatioCall.call n c (st 0 0) Inv32FloorHoist.a0 Inv32FloorHoist.a1 Inv32FloorHoist.a2 [ratioRet] y net x hy hn hx pos rfl rfl rfl
  have U : (st 0 0).assignLocal? ratioRet (.word q) = some (st 0 q) := by dsimp [st,rt,withNet,base,frm,flag,ratioRet]; write_temps
  have cap := Inv32Hoist.takeReturn _ _ _ _ _ _ _ _ _ call U
  have copy := Inv32Hoist.lastCopy (n+276) t c (st 0 q) (st q q) flag ratioRet 0 q rfl rfl
    (by dsimp [st,rt,withNet,base,frm,flag,ratioRet]; write_temps)
  dsimp only
  rw [Inv32.ratio_correct y net x hy hn hx pos]
  apply Inv32Hoist.block _ _ _ _ (st q q)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ C).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans copy))))
end Inv32ForwardSteps
