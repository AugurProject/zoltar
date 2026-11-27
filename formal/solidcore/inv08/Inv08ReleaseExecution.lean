import Inv08ReleaseQuoteCall
import Inv08AuthorityBytes
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Release
private theorem normal3 (n : Nat) (t : FunctionTable) (c : Context) (a b d : Stmt)
    (r x y z : Runtime) (A : a.eval n t c r.pushScope = pure (.normal x))
    (B : b.eval n t c x = pure (.normal y)) (D : d.eval n t c y = pure (.normal z)) :
    (Stmt.block [a,b,d]).eval (n+1) t c r = pure (.normal z.popScope) :=
  Inv32Hoist.block n t c r z _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] D).trans (by rw [Stmt.evalList]))))
private theorem outer (n : Nat) (t : FunctionTable) (c : Context) (param nested : Stmt)
    (r z : Runtime) (P : param.eval (n+1) t c r.pushScope = pure (.normal r.pushScope))
    (N : nested.eval (n+1) t c r.pushScope = pure (.normal z)) :
    (Stmt.block [param,.skip,.skip,nested]).eval (n+2) t c r = pure (.normal z.popScope) := by
  have S : Stmt.eval (n+1) t c r.pushScope .skip = pure (.normal r.pushScope) := by rw [Stmt.eval]
  exact Inv32Hoist.block (n+1) t c r z _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] N).trans (by rw [Stmt.evalList])))))
private theorem postGuard (c : Context) (r : Runtime) (tm a b : Nat) :
    Authority.post c (guarded r tm a b) = guarded (Authority.post c r) tm a b := rfl
private theorem restore (r : Runtime) (s : State) (tm a b : Nat) :
    ({guarded r tm a b with state:=s} : Runtime).popScope =
      ({r.withFrame (frame tm a b) with state:=s} : Runtime).pushScope.pushScope := rfl
private theorem modEq : modifiers.value =
    .block [Authority.callerGuard.value,Authority.initializedGuard.value,captured.value] := rfl

set_option maxHeartbeats 500000 in
/-- Execute the generated modifier blocks and their release body. -/
theorem execute (n : Nat) (c : Context) (r : Runtime) (tm : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (h : Ready r.state tm) (current : tm≤EnvWord.blockTimestamp.eval c) (word : EnvWord.blockTimestamp.eval c<R)
    (auth : Authority.callerGuard.value.eval (n+67) model.core.table c (guarded r tm 0 0) =
      pure (.normal (Authority.post c (guarded r tm 0 0))))
    (initialized : Authority.initializedGuard.value.eval (n+67) model.core.table c (Authority.post c (guarded r tm 0 0)) =
      pure (.normal (Authority.post c (guarded r tm 0 0)))) :
    let e := Preview.payout r.state tm true
    let p := Preview.payout r.state tm false
    body.value.eval (n+70) model.core.table c (r.withFrame (frame tm 0 0)) =
      pure (.normal {(Authority.post c r).withFrame (frame tm e p) with state:=post r.state tm}) := by
  let t := model.core.table
  let src := r.withFrame (frame tm 0 0)
  let copied := Authority.post c r
  let e := Preview.payout r.state tm true
  let p := Preview.payout r.state tm false
  let dst := {copied.withFrame (frame tm e p) with state:=post r.state tm}
  let endR := {guarded copied tm e p with state:=post r.state tm}
  have B : captured.value.eval (n+67) t c (guarded copied tm 0 0) = pure (.normal endR) :=
    afterGuard n c copied tm fields h current word
  rw [postGuard] at auth initialized
  have M0 := normal3 (n+67) t c Authority.callerGuard.value Authority.initializedGuard.value captured.value
    src.pushScope.pushScope (guarded copied tm 0 0) (guarded copied tm 0 0) endR auth initialized B
  have M : modifiers.value.eval (n+68) t c src.pushScope.pushScope = pure (.normal dst.pushScope.pushScope) := by
    rw [modEq,M0]
    have cleared : endR.popScope = dst.pushScope.pushScope := restore copied (post r.state tm) tm e p
    rw [cleared]
  have N : nested.value.eval (n+69) t c src.pushScope = pure (.normal dst.pushScope) :=
    Inv32Blocks.one (n+68) t c src.pushScope dst.pushScope.pushScope modifiers.value M
  have P := Inv32Assign.scalarCast (n+68) t c src.pushScope src.pushScope "until" tm tm _ _ _ rfl
    (Expiry.local48 c src.pushScope "until" tm h.time rfl _ (Nat.le_succ _)) (by dsimp [src]; release_write)
  exact outer (n+68) t c _ nested.value src dst.pushScope P N
end Inv08.Release
