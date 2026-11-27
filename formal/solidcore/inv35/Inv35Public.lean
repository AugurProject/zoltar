import Inv35Bindings
import Inv32Observed

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Dispatch Inv32Division
open Inv32RatioLoop (answer)
namespace Inv35Source
open Inv32FloorFastPath Inv32FloorStart
private theorem libraryCall (n : Nat) (c : Context) (r : Runtime) (x y : Nat) (targets : List String)
    (hx : x<R) (hy : y<R) (pos : 0<x+y)
    (X : r.lookupLocal? a0 = some (.word x)) (Y : r.lookupLocal? a1 = some (.word y)) :
    Stmt.eval (n+282) model.core.table c r (.internalCall targets key [.var a0,.var a1]) =
      internalCallAssign r targets [.word (answer 10000 y x)] := by
  obtain ⟨f,lk,ps,rs,bd⟩ := linked
  let empty := {r with locals := []}
  let src := empty.withFrame (frame x y)
  have enter : internalCallEnter? f [.word x,.word y] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have ev := execute n {c with checked := true} empty x y hx hy pos
  change Stmt.eval _ _ _ src _ = _ at ev
  rw [← bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args _ _ _ _ _ _ X Y) lk enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
    empty,Runtime.withFrame,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
    Ty.coerceValue?,Bind.bind,Except.bind]

private def forwarding := Stmt.block [temp a0 "yesReserve",temp a1 "noReserve",.varDecl .uint256 spotRet none,
  .captureReturn [spotRet] (.internalCall [spotRet] key [.var a0,.var a1]),.assign (.var flag) (.var spotRet)]
private def wrapper := Stmt.block [cleanParam "yesReserve",cleanParam "noReserve",.skip,
  .block [.varDecl .uint256 flag none,forwarding,.returnValues [(Inv32QuoteExpr.castCopy flag).core]]]

private theorem forward (n : Nat) (c : Context) (r : Runtime) (x y : Nat)
    (hx : x<R) (hy : y<R) (pos : 0<x+y) :
    let base := (r.withFrame (frame x y)).pushScope.pushScope
    let saved := fun v => base.declareLocal flag (.word v)
    Stmt.eval (n+285) model.core.table c (saved 0) forwarding = pure (.normal (saved (answer 10000 y x))) := by
  dsimp only
  let t := model.core.table
  let base := (r.withFrame (frame x y)).pushScope.pushScope
  let s := fun v => base.declareLocal flag (.word v)
  let t0 := fun v => (s v).pushScope.declareLocal a0 (.word x)
  let t1 := fun v => (t0 v).declareLocal a1 (.word y)
  let st := fun v w => (t1 v).declareLocal spotRet (.word w)
  let q := answer 10000 y x
  have A := Inv32Temps.temp (n+283) t c (s 0).pushScope a0 "yesReserve" x hx rfl
  have B := Inv32Temps.temp (n+283) t c (t0 0) a1 "noReserve" y hy rfl
  have Z := zero (n+283) t c (t1 0) spotRet
  have call := libraryCall (n+1) c (st 0 0) x y [spotRet] hx hy pos rfl rfl
  have cap := Inv32Hoist.takeReturn _ _ _ _ (st 0 q) _ _ _ _ call
    (by dsimp [st,t1,t0,s,base,q,spotRet]; write_spot_local)
  have finish := Inv32Hoist.lastCopy (n+283) t c (st 0 q) (st q q) flag spotRet 0 q rfl rfl
    (by dsimp [st,t1,t0,s,base,spotRet]; write_spot_local)
  exact Inv32Hoist.block _ _ _ _ (st q q) _ ((seqStep _ _ _ _ _ _ _ A).trans
    ((seqStep _ _ _ _ _ _ _ B).trans ((seqStep _ _ _ _ _ _ _ Z).trans ((seqStep _ _ _ _ _ _ _ cap).trans finish))))

theorem publicBody (n : Nat) (c : Context) (r : Runtime) (x y : Nat)
    (hx : x<R) (hy : y<R) (pos : 0<x+y) :
    let src := r.withFrame (frame x y)
    Stmt.eval (n+287) model.core.table c src fn.body = pure (.returned src [.word (answer 10000 y x)]) := by
  rw [wrapperBody]
  change Stmt.eval _ _ _ _ wrapper = _
  let src := r.withFrame (frame x y)
  let t := model.core.table
  let outer := src.pushScope
  let inner := outer.pushScope
  let q := answer 10000 y x
  let next := inner.declareLocal flag (.word q)
  have qr : q<R := lt_of_le_of_lt (Inv32RatioLoop.bound 10000 y x pos) (by decide)
  have A := cleanParamExec (n+285) t c outer "yesReserve" x hx rfl (by dsimp [outer,src]; write_spot_local)
  have B := cleanParamExec (n+285) t c outer "noReserve" y hy rfl (by dsimp [outer,src]; write_spot_local)
  have S : Stmt.eval (n+286) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have Z := zero (n+284) t c inner flag
  have P := forward n c r x y hx hy pos
  have T := Inv32CompareValues.retOne (n+284) t c next (Inv32QuoteExpr.castCopy flag).core q
    (Inv32Actions.evalFormula _ c next q (by decide) (Inv32QuoteExpr.castValue _ (Inv32Actions.locals next) flag q qr rfl))
  have H := blockReturned _ t c outer next _ _ ((seqStep _ _ _ _ _ _ _ Z).trans
    ((seqStep _ _ _ _ _ _ _ P).trans (stop _ _ _ _ _ _ [] _ T)))
  exact blockReturned _ t c src outer _ _ ((seqStep _ _ _ _ _ _ _ A).trans
    ((seqStep _ _ _ _ _ _ _ B).trans ((seqStep _ _ _ _ _ _ _ S).trans (stop _ _ _ _ _ _ [] _ H))))
end Inv35Source
