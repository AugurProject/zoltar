import Inv32RatioCall

open SolidCore.Solidity.Source Inv32Dispatch Inv32Division Inv32FloorFastPath Inv32FloorStart
open Inv32RatioLoop (answer)
namespace Inv35Source
abbrev flag := "_sol_hoist_0"
abbrev ret := "_ret___library_TwoWayConstantProductMath__ratioOfSum_0"
abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev a2 := "_ic_arg_2"
def key := "__internal___library_TwoWayConstantProductMath_conditionalYesBps(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def guardExpr := Expr.binary .boolOr (Inv32Guards.positiveLocal "yesReserve") (Inv32Guards.positiveLocal "noReserve")
def guardStmt := Stmt.requireStmt guardExpr (some "Empty reserves")
def constantBps := Expr.ternary (.word 1) (.word 10000) (.word 10000)
def pricing := Stmt.block [.varDecl .uint256 a0 (some constantBps),temp a1 "noReserve",temp a2 "yesReserve",
  .varDecl .uint256 ret none,.captureReturn [ret] (.internalCall [ret] Inv32Bodies.Ratio.key [.var a0,.var a1,.var a2]),
  .assign (.var flag) (.var ret)]
def code := Stmt.block [cleanParam "yesReserve",cleanParam "noReserve",.skip,
  .block [guardStmt,.varDecl .uint256 flag none,pricing,.returnValues [.castOp .uintCleanup 256 (.var flag)]]]
def frame (x y : Nat) : Frame := [("yesReserve",.word x),("noReserve",.word y),("_ret0",.word 0)]

private theorem guardPass (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y : Nat)
    (hx : x<R) (hy : y<R) (pos : 0<x+y)
    (X : r.lookupLocal? "yesReserve" = some (.word x)) (Y : r.lookupLocal? "noReserve" = some (.word y)) :
    Stmt.eval (n+1) t c r guardStmt = pure (.normal r) := by
  let m := guardExpr.orderFuel - 3
  have f : guardExpr.orderFuel = m+3 := by decide
  have ev : Expr.eval c r guardExpr = pure (.word 1,r) := by
    unfold Expr.eval
    rw [f]
    change Expr.evalFuel (m+3+1) c r (.binary .boolOr _ _) = _
    rw [Expr.evalFuel,Inv32Guards.positiveRead _ _ _ _ _ hx X]
    by_cases h : 0<x
    · rw [if_pos h]; rfl
    · rw [if_neg h]
      change (do let (v,r') ← Expr.evalFuel (m+3) c r (Inv32Guards.positiveLocal "noReserve")
                 let w ← liftM v.expectWord
                 pure (Value.word (boolWord (wordTruthy w)),r')) = _
      rw [Inv32Guards.positiveRead _ _ _ _ _ hy Y, if_pos (by omega)]
      rfl
  change Stmt.eval (n+1) t c r (.requireStmt guardExpr _) = _
  rw [Stmt.eval]; dsimp only; rw [ev]; rfl

macro "write_spot_local" : tactic => `(tactic|
  simp [Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.pushScope,Runtime.withFrame,Runtime.declareLocal,
    LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,
    frame,flag,ret,a0,a1,a2])
set_option maxRecDepth 8192
private theorem executePrice (n : Nat) (c : Context) (r : Runtime) (x y : Nat)
    (hx : x<R) (hy : y<R) (pos : 0<x+y) :
    let base := (r.withFrame (frame x y)).pushScope.pushScope
    let saved := fun v => base.declareLocal flag (.word v)
    Stmt.eval (n+279) model.core.table c (saved 0) pricing = pure (.normal (saved (answer 10000 y x))) := by
  dsimp only
  let t := model.core.table
  let base := (r.withFrame (frame x y)).pushScope.pushScope
  let s := fun v => base.declareLocal flag (.word v)
  let t0 := fun v => (s v).pushScope.declareLocal a0 (.word 10000)
  let t1 := fun v => (t0 v).declareLocal a1 (.word y)
  let t2 := fun v => (t1 v).declareLocal a2 (.word x)
  let st := fun v w => (t2 v).declareLocal ret (.word w)
  let q := answer 10000 y x
  have A := Inv32Hoist.declEval (n+277) t c (s 0).pushScope a0 .uint256 constantBps 10000 (by rfl) (by rfl)
  have B := Inv32Temps.temp (n+277) t c (t0 0) a1 "noReserve" y hy rfl
  have C := Inv32Temps.temp (n+277) t c (t1 0) a2 "yesReserve" x hx rfl
  have D := zero (n+277) t c (t2 0) ret
  have call := Inv32RatioCall.call (n+1) c (st 0 0) a0 a1 a2 [ret] 10000 y x (by decide) hy hx pos rfl rfl rfl
  have cap := Inv32Hoist.takeReturn _ _ _ _ (st 0 q) _ _ _ _ call (by dsimp [st,t2,t1,t0,s,base,q]; write_spot_local)
  have finish := Inv32Hoist.lastCopy (n+277) t c (st 0 q) (st q q) flag ret 0 q rfl rfl (by dsimp [st,t2,t1,t0,s,base]; write_spot_local)
  exact Inv32Hoist.block _ _ _ _ (st q q) _ ((seqStep _ _ _ _ _ _ _ A).trans
    ((seqStep _ _ _ _ _ _ _ B).trans ((seqStep _ _ _ _ _ _ _ C).trans
    ((seqStep _ _ _ _ _ _ _ D).trans ((seqStep _ _ _ _ _ _ _ cap).trans finish)))))

theorem execute (n : Nat) (c : Context) (r : Runtime) (x y : Nat)
    (hx : x<R) (hy : y<R) (pos : 0<x+y) :
    let src := r.withFrame (frame x y)
    Stmt.eval (n+281) model.core.table c src code = pure (.returned src [.word (answer 10000 y x)]) := by
  let src := r.withFrame (frame x y)
  let t := model.core.table
  let outer := src.pushScope
  let inner := outer.pushScope
  let q := answer 10000 y x
  let next := inner.declareLocal flag (.word q)
  have qr : q<R := lt_of_le_of_lt (Inv32RatioLoop.bound 10000 y x pos) (by decide)
  have A := cleanParamExec (n+279) t c outer "yesReserve" x hx rfl (by dsimp [outer,src]; write_spot_local)
  have B := cleanParamExec (n+279) t c outer "noReserve" y hy rfl (by dsimp [outer,src]; write_spot_local)
  have S : Stmt.eval (n+280) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have G := guardPass (n+278) t c inner x y hx hy pos rfl rfl
  have Z := zero (n+278) t c inner flag
  have P := executePrice n c r x y hx hy pos
  have T := Inv32CompareValues.retOne (n+278) t c next (.castOp .uintCleanup 256 (.var flag)) q
    (Inv32Guards.clean _ _ _ _ _ qr (Inv32Guards.readWord _ _ _ _ _ rfl))
  have H := blockReturned _ t c outer next _ _ ((seqStep _ _ _ _ _ _ _ G).trans
    ((seqStep _ _ _ _ _ _ _ Z).trans ((seqStep _ _ _ _ _ _ _ P).trans (stop _ _ _ _ _ _ [] _ T))))
  exact blockReturned _ t c src outer _ _ ((seqStep _ _ _ _ _ _ _ A).trans
    ((seqStep _ _ _ _ _ _ _ B).trans ((seqStep _ _ _ _ _ _ _ S).trans (stop _ _ _ _ _ _ [] _ H))))
end Inv35Source
