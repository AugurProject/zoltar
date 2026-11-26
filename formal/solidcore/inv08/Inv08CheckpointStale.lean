import Inv08CheckpointClock
import Inv08CheckpointDeferred
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Checkpoint
def atView (r : Runtime) (now : Nat) := (hoist r now).declareLocal "#view540" (.word now)
def staleE (r : Runtime) (now e : Nat) := (atView r now).declareLocal "staleEth" (.word e)
def staleP (r : Runtime) (now e p : Nat) := (staleE r now e).declareLocal "staleRep" (.word p)
def staleArg (r : Runtime) (now e p : Nat) := (staleP r now e p).declareLocal a0 (.word now)
def staleRE (r : Runtime) (now e p a : Nat) := (staleArg r now e p).declareLocal er (.word a)
def staleRP (r : Runtime) (now e p a b : Nat) := (staleRE r now e p a).declareLocal pr (.word b)
macro "stale_write" : tactic => `(tactic|
  simp [staleRP,staleRE,staleArg,staleP,staleE,atView,hoist,er,pr,a0,internalCallAssign,
    Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.lookupLocal?,Runtime.assignLocal?,
    Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,
    Frame.lookup?,Frame.assign?,Value.coerceLike?])
def afterStale (c : Context) (r : Runtime) (now : Nat) :=
  let post := Release.afterCall c r now
  {post with state:=deferred post.state (Preview.payout r.state now true) (Preview.payout r.state now false)}
def BucketsFit (s : State) (now : Nat) := ∀ eth, stored (Release.post s now) (deferredField eth)+Preview.payout s now eth<R
set_option maxHeartbeats 1100000 in
theorem payStale (n : Nat) (c : Context) (r : Runtime) (now : Nat) (clockTime : EnvWord.blockTimestamp.eval c=now)
    (fields : c.storageFields=model.core.context.storageFields) (clone : Authority.Clone c r)
    (h : Release.Ready r.state now) (fit : BucketsFit r.state now) :
    staleBody.value.eval (n+73) model.core.table c r=pure (.normal (afterStale c r now)) := by
  let t := model.core.table
  let e := Preview.payout r.state now true
  let p := Preview.payout r.state now false
  let dst := Release.afterCall c r now
  have H := Inv32FloorStart.zero (n+71) t c r.pushScope "_sol_hoist_0"
  have T := clock (n+66) c r now clockTime h.time
  have V := Inv32Hoist.declEval (n+71) t c (hoist r now) "#view540" .uint256 _ now
    (Authority.castBits (Authority.castBits (Expiry.local48 c (hoist r now) "_sol_hoist_0" now h.time rfl) 48 (by decide) (by decide) h.time) 48
      (by decide) (by decide) h.time _ (Nat.le_succ _)) (by rfl)
  have ZE := Inv32FloorStart.zero (n+71) t c (atView r now) "staleEth"
  have ZP := Inv32FloorStart.zero (n+71) t c (staleE r now 0) "staleRep"
  have A := Inv32Hoist.declEval (n+71) t c (staleP r now 0 0) a0 .uint256 _ now
    (Expiry.local48 c _ "#view540" now h.time rfl _ (Nat.le_succ _)) (by rfl)
  have X := Inv32FloorStart.zero (n+71) t c (staleArg r now 0 0) er
  have Y := Inv32FloorStart.zero (n+71) t c (staleRE r now 0 0 0) pr
  have C := Release.internal n c (staleRP r now 0 0 0 0) a0 [er,pr] now rfl fields clone h (Nat.le_of_eq clockTime.symm)
  have store : internalCallAssign (staleRP dst now 0 0 0 0) [er,pr] [.word e,.word p]=pure (.normal (staleRP dst now 0 0 e p)) := by stale_write
  have same : Release.afterCall c (staleRP r now 0 0 0 0) now = staleRP dst now 0 0 0 0 := by
    dsimp only [dst,Release.afterCall,Authority.post,Authority.bytes,Runtime.allocMemory,staleRP,staleRE,staleArg,staleP,staleE,atView,hoist,Runtime.pushScope,Runtime.declareLocal]
  rw [same] at C
  change Stmt.eval (n+71) t c (staleRP r now 0 0 0 0) (.internalCall [er,pr] Release.internalKey [.var a0]) = internalCallAssign (staleRP dst now 0 0 0 0) [er,pr] [.word e,.word p] at C
  have captured : relCall.value.eval (n+72) t c (staleRP r now 0 0 0 0)=pure (.normal (staleRP dst now 0 0 e p)) := Inv32Internal.capture _ _ _ _ _ [er,pr] _ (C.trans store)
  have E := Inv32Temps.copy (n+71) t c (staleRP dst now 0 0 e p) (staleRP dst now e 0 e p) "staleEth" er 0 e rfl rfl (by stale_write)
  have P := Inv32Temps.copy (n+71) t c (staleRP dst now e 0 e p) (staleRP dst now e p e p) "staleRep" pr 0 p rfl rfl (by stale_write)
  let credited := {dst with state:=deferAsset dst.state true e}
  have creditE := deferRuns (n+71) t c (staleRP dst now e p e p) true e fields rfl (fit true)
  have pFit : stored credited.state .repDeferred+p<R := by
    dsimp only [credited]
    rw [secondUnaffected]
    exact fit false
  have creditP := deferRuns (n+71) t c (staleRP credited now e p e p) false p fields rfl pFit
  let final := afterStale c r now
  have firstWrite : ({staleRP dst now e p e p with state:=deferAsset dst.state true e} : Runtime)=staleRP credited now e p e p := by
    dsimp only [credited,staleRP,staleRE,staleArg,staleP,staleE,atView,hoist,Runtime.pushScope,Runtime.declareLocal]
  change (deferStmt true).value.eval (n+72) t c (staleRP dst now e p e p)=pure (.normal {staleRP dst now e p e p with state:=deferAsset dst.state true e}) at creditE
  rw [firstWrite] at creditE
  have lastWrite : ({staleRP credited now e p e p with state:=deferAsset credited.state false p} : Runtime)=staleRP final now e p e p := by
    dsimp only [credited,final,afterStale,deferred,e,p,dst,staleRP,staleRE,staleArg,staleP,staleE,atView,hoist,Runtime.pushScope,Runtime.declareLocal]
  change (deferStmt false).value.eval (n+72) t c (staleRP credited now e p e p)=pure (.normal {staleRP credited now e p e p with state:=deferAsset credited.state false p}) at creditP
  rw [lastWrite] at creditP
  have B := Inv32Hoist.block (n+72) t c r (staleRP (afterStale c r now) now e p e p) _ (
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ H).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ T).trans (
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ V).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ ZE).trans (
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ ZP).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans (
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ X).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Y).trans (
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ captured).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ E).trans (
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ creditE).trans (
    (Inv32FloorStart.seqStep _ _ _ _ _ _ [] creditP).trans (by rw [Stmt.evalList]))))))))))))))
  have restored (rt : Runtime) : (staleRP rt now e p e p).popScope=rt := by
    cases rt; rfl
  rw [restored] at B
  exact B
end Inv08.Checkpoint
