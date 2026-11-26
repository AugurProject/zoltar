import Inv27Bindings
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32FloorFastPath Inv32Hoist Inv32Actions Inv32QuoteExpr Inv03.Bodies
namespace Inv27.Harness
private def temps (r : Runtime) (cons : Bool) (o p e v : Nat) :=
  (st2 r tmp o p e).declareLocal (slot cons) (.word v)
private def states (r : Runtime) (cons : Bool) (p e : Nat) : Answer → Runtime
  | .value v => Inv32OneArg.store r tmp v
  | .error _ => (cs (temps r cons 0 p e 0) p e).popScope
private def after (r : Runtime) : Answer → Result
  | .value _ => .normal r
  | .error msg => .reverted r (.error msg)

theorem hoistExec (n : Nat) (c : Context) (r : Runtime) (cons : Bool) (p e : Nat) (hp : p<R) (he : e<R)
    (P : (start r tmp 0).lookupLocal? "price"=some (.word p))
    (E : (st1 r tmp 0 p).lookupLocal? "uncertainty"=some (.word e)) :
    Stmt.eval (n+25) table c (Inv32OneArg.store r tmp 0) (hoisted cons).value =
      pure (after (states r cons p e (quote cons p e)) (quote cons p e)) := by
  let st := fun o v => temps r cons o p e v
  let callee := Stmt.internalCall [slot cons] (key cons) [.var a0,.var a1]
  let capture := Stmt.captureReturn [slot cons] callee
  let copy := Stmt.assign (.var tmp) (.var (slot cons))
  have leading : Stmt.evalList (n+24) table c (start r tmp 0)
      [temp a0 "price",temp a1 "uncertainty",.varDecl .uint256 (slot cons) none,capture,copy] =
      Stmt.evalList (n+24) table c (st 0 0) [capture,copy] :=
    (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+23) table c _ a0 "price" p hp P)).trans
      ((seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+23) table c _ a1 "uncertainty" e he E)).trans
      (seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+23) table c _ (slot cons))))
  have call := libraryCall n c (st 0 0) p e hp he cons rfl rfl
  unfold called at call
  cases h : quote cons p e with
  | value v =>
    rw [h] at call
    have put : (st 0 0).assignLocal? (slot cons) (.word v) = some (st 0 v) := by
      cases cons <;> cases H : r.locals <;> dsimp [st,temps,slot,apiName] <;> write_temps
    have cap := takeReturn _ _ _ _ _ _ _ _ _ call put
    have cp : Stmt.evalList (n+24) table c (st 0 v) [copy] = pure (.normal (st v v)) := by
      apply lastCopy _ _ _ _ _ _ _ 0 v
      all_goals cases cons <;> cases H : r.locals <;> dsimp [st,temps,slot,apiName,tmp,Inv32CeilFlags.h0] <;> write_temps
    exact Inv32Hoist.block _ _ _ _ (st v v) _ (leading.trans ((seqStep _ _ _ _ _ _ _ cap).trans cp))
  | error msg =>
    rw [h] at call
    have cap := Inv32Revert.capture _ _ _ _ _ _ [slot cons] _ call
    exact Inv32Revert.blockRevert _ _ _ _ _ _ _ (leading.trans (Inv32Revert.stop _ _ _ _ _ _ [copy] _ cap))

end Inv27.Harness

namespace Inv27.Harness
def Satisfies (execution : SolI Result) (start : Runtime) : Answer → Prop
  | .value v => execution = pure (.returned start [.word v])
  | .error msg => ∃ next, execution = pure (.reverted next (.error msg))

theorem execute (f : Nat) (c : Context) (r : Runtime) (p e : Nat) (hp : p<R) (he : e<R) (cons : Bool) :
    let src := r.withFrame (frame p e)
    Satisfies (Stmt.eval (f+27) table c src (fn cons).body) src (quote cons p e) := by
  let src := r.withFrame (frame p e)
  let outer := src.pushScope
  let inner := outer.pushScope
  let outerCode := [cleanParam "price",cleanParam "uncertainty",Stmt.skip,
    .block [init,(hoisted cons).value,output]]
  have bodyEq : (fn cons).body = .block outerCode := (checkedBody cons).trans rfl
  rw [bodyEq]
  have A := cleanParamExec (f+25) table c outer "price" p hp rfl (by dsimp [outer,src,frame]; write_param)
  have B := cleanParamExec (f+25) table c outer "uncertainty" e he rfl (by dsimp [outer,src,frame]; write_param)
  have sk : Stmt.eval (f+26) table c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have leading : Stmt.evalList (f+26) table c outer outerCode =
      Stmt.evalList (f+26) table c outer [.block [init,(hoisted cons).value,output]] :=
    (seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans (seqStep _ _ _ _ _ _ _ sk))
  have initStep := Inv32FloorStart.zero (f+24) table c inner tmp
  have nested := hoistExec f c inner cons p e hp he rfl rfl
  cases h : quote cons p e with
  | value v =>
    rw [h] at nested
    let fin := Inv32OneArg.store inner tmp v
    have out := Inv32CompareValues.retOne (f+24) table c fin (castCopy tmp).core v
      (evalFormula (castCopy tmp) _ _ _ (by decide) (castValue _ _ _ _ (outputFits _ _ _ _ hp h) rfl))
    have mid := blockReturned _ table c outer fin [init,(hoisted cons).value,output] _
      ((seqStep _ _ _ _ _ _ _ initStep).trans ((seqStep _ _ _ _ _ _ _ nested).trans (stop _ _ _ _ _ _ [] _ out)))
    exact blockReturned _ table c src outer outerCode _ (leading.trans (stop _ _ _ _ _ _ [] _ mid))
  | error msg =>
    rw [h] at nested
    have mid := Inv32Revert.blockRevert _ table c outer _ [init,(hoisted cons).value,output] _
      ((seqStep _ _ _ _ _ _ _ initStep).trans (Inv32Revert.stop _ _ _ _ _ _ [output] _ nested))
    exact ⟨_,Inv32Revert.blockRevert _ table c src _ outerCode _ (leading.trans (Inv32Revert.stop _ _ _ _ _ _ [] _ mid))⟩
end Inv27.Harness
