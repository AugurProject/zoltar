import Inv08CheckpointEligible
import Inv08CheckpointStale
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Checkpoint
def finish (c : Context) (r : Runtime) (now : Nat) :=
  if stored r.state .through<now then afterStale c r now else r
def result (c : Context) (r : Runtime) (tm now : Nat) := finish c (afterEligible c r tm) now
def eligibleState (s : State) (tm : Nat) := if stored s .through<tm then Release.post s tm else s
theorem eligibleStateEq (c : Context) (r : Runtime) (tm : Nat) : (afterEligible c r tm).state=eligibleState r.state tm := by
  unfold afterEligible eligibleState
  split <;> rfl
structure Ready (s : State) (tm now : Nat) : Prop where
  time : tm<2^48
  current : tm≤now
  initialized : 0<stored s .duration
  eligible : stored s .through<tm → Release.Ready s tm
  stale : stored (eligibleState s tm) .through<now → Release.Ready (eligibleState s tm) now
  room : stored (eligibleState s tm) .through<now → BucketsFit (eligibleState s tm) now
private theorem envField (s : State) (k : Field) (v : Nat) : (s.storeFieldWord k.field v).envWorld?=s.envWorld? := by
  cases k <;> rfl
private theorem envAfter (s : State) (tm : Nat) : (Release.post s tm).envWorld?=s.envWorld? := by
  simp only [Release.post,Release.timestamped,Release.repDebited,Release.ethDebited,Release.repCredited,Release.ethCredited,envField]
private theorem bytesAfter (c : Context) (r : Runtime) (tm : Nat) :
    Authority.bytes c (Release.afterCall c r tm)=Authority.bytes c r := by
  unfold Authority.bytes State.envAccountCode State.envAccount?
  dsimp only [Release.afterCall]
  rw [envAfter]
theorem cloneAfter (c : Context) (r : Runtime) (tm : Nat) (clone : Authority.Clone c r) :
    Authority.Clone c (afterEligible c r tm) := by
  unfold afterEligible
  split
  · unfold Authority.Clone at *
    rw [bytesAfter]
    exact clone
  · exact clone
theorem readStale (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields) :
    staleCond.value.eval c r=pure (.word (boolWord (decide (stored r.state .through<EnvWord.blockTimestamp.eval c))),r) := by
  have cw := Release.clockWord c
  have sf : stored r.state .through<R := lt_trans (throughFit _) (by decide)
  simpa [boolWord] using ReleaseQuote.binary (ReleaseQuote.readClean (clockReads c r) cw) (ReleaseQuote.readClean (reads c r .through fields) sf)
    .gt (by intro h; cases h) (by intro h; cases h) (Inv32QuoteExpr.gt c.checked _ _ cw sf) _ (Nat.le_succ _)
theorem stalePhase (n : Nat) (c : Context) (r : Runtime) (now : Nat) (time : EnvWord.blockTimestamp.eval c=now)
    (fields : c.storageFields=model.core.context.storageFields) (clone : Authority.Clone c r)
    (ready : stored r.state .through<now → Release.Ready r.state now) (room : stored r.state .through<now → BucketsFit r.state now) :
    stale.value.eval (n+74) model.core.table c r=pure (.normal (finish c r now)) := by
  have test := readStale c r fields
  rw [time] at test
  let yes := decide (stored r.state .through<now)
  have branch := Inv32Blocks.branch (n+73) model.core.table c r staleCond.value staleBody.value .skip yes test
  apply branch.trans
  by_cases ok : stored r.state .through<now
  · rw [if_pos (show yes=true from decide_eq_true ok)]
    simp only [finish,if_pos ok]
    exact payStale n c r now time fields clone (ready ok) (room ok)
  · rw [if_neg (show ¬yes=true from by rw [show yes=false from decide_eq_false ok]; decide)]
    simp only [finish,if_neg ok]
    rw [Stmt.eval]
private theorem rootFinish (c : Context) (r : Runtime) (tm now a b : Nat) :
    finish c (root r tm a b) now=root (finish c r now) tm a b := by
  unfold finish
  change (if stored r.state .through<now then _ else _)=_
  by_cases yes : stored r.state .through<now
  · rw [if_pos yes,if_pos yes]
    dsimp only [afterStale,Release.afterCall,root,guarded,Authority.post,Authority.bytes,Runtime.allocMemory,Runtime.withFrame,Runtime.pushScope]
  · rw [if_neg yes,if_neg yes]
theorem phases (n : Nat) (c : Context) (r : Runtime) (tm now : Nat) (time : EnvWord.blockTimestamp.eval c=now)
    (fields : c.storageFields=model.core.context.storageFields) (clone : Authority.Clone c r) (ready : Ready r.state tm now) :
    captured.value.eval (n+76) model.core.table c (guarded r tm 0 0)=
      pure (.normal (guarded (result c r tm now) tm (earned r.state tm true) (earned r.state tm false))) := by
  let mid := afterEligible c r tm
  let e := earned r.state tm true
  let p := earned r.state tm false
  have A := earnedPhase n c r tm fields clone ready.time ready.eligible (by rw [time]; exact ready.current)
  have S := stalePhase n c (root mid tm e p) now time fields (cloneAfter c r tm clone)
    (show stored mid.state .through<now → Release.Ready mid.state now from by
      dsimp only [mid]; rw [eligibleStateEq]; exact ready.stale)
    (show stored mid.state .through<now → BucketsFit mid.state now from by
      dsimp only [mid]; rw [eligibleStateEq]; exact ready.room)
  rw [rootFinish] at S
  have B := Inv32Hoist.block (n+74) model.core.table c (guarded r tm 0 0) (root (finish c mid now) tm e p) _
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] S).trans (by rw [Stmt.evalList])))
  have restore (rt : Runtime) : (root rt tm e p).popScope=guarded rt tm e p := rfl
  rw [restore] at B
  exact Inv32Internal.capture _ _ _ _ _ ["ethAmount","repAmount"] _ B
end Inv08.Checkpoint
