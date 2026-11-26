import Inv08CheckpointShape
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Checkpoint
def guarded (r : Runtime) (tm a b : Nat) := (r.withFrame (frame tm a b)).pushScope.pushScope.pushScope
def root (r : Runtime) (tm a b : Nat) := (guarded r tm a b).pushScope
def arg (r : Runtime) (tm a b : Nat) := (root r tm a b).pushScope.declareLocal a0 (.word tm)
def withEth (r : Runtime) (tm a b e : Nat) := (arg r tm a b).declareLocal er (.word e)
def withBoth (r : Runtime) (tm a b e p : Nat) := (withEth r tm a b e).declareLocal pr (.word p)
macro "checkpoint_write" : tactic => `(tactic|
  simp [withBoth,withEth,arg,root,guarded,frame,a0,er,pr,internalCallAssign,Runtime.assignNamedValuesRef?,
    Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.withFrame,
    Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem throughFit (s : State) : stored s .through < 2^48 := by
  change SolidCore.Solidity.Shared.norm (_ % 2^48) < 2^48
  have low (n : Nat) : SolidCore.Solidity.Shared.norm (n % 2^48) < 2^48 := by
    have small := Nat.mod_lt n (by decide : 0<2^48)
    rwa [show SolidCore.Solidity.Shared.norm (n % 2 ^ 48) = n % 2^48 from Nat.mod_eq_of_lt (lt_trans small (by decide))]
  exact low _
theorem readEligible (c : Context) (r : Runtime) (tm : Nat) (found : r.lookupLocal? "eligibleThrough"=some (.word tm))
    (tf : tm<2^48) (fields : c.storageFields=model.core.context.storageFields) :
    eligibleCond.value.eval c r = pure (.word (boolWord (decide (stored r.state .through<tm))),r) := by
  have sf := throughFit r.state
  simpa [boolWord] using ReleaseQuote.binary (Expiry.local48 c r _ _ tf found) (Expiry.cleaned (reads c r .through fields) sf)
    .gt (by intro h; cases h) (by intro h; cases h) (Inv32QuoteExpr.gt c.checked _ _ (lt_trans tf (by decide)) (lt_trans sf (by decide))) _ (Nat.le_succ _)
set_option maxHeartbeats 1500000 in
theorem payEligible (n : Nat) (c : Context) (r : Runtime) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (clone : Authority.Clone c r)
    (h : Release.Ready r.state tm) (current : tm≤EnvWord.blockTimestamp.eval c) :
    let e := Preview.payout r.state tm true
    let p := Preview.payout r.state tm false
    (Inv03.Bodies.block (pay "eligibleThrough" "ethAmount" "repAmount")).value.eval (n+73) model.core.table c (root r tm 0 0)
      = pure (.normal (root (Release.afterCall c r tm) tm e p)) := by
  let t := model.core.table
  let dst := Release.afterCall c r tm
  let e := Preview.payout r.state tm true
  let p := Preview.payout r.state tm false
  let src := root r tm 0 0
  have A := Inv32Hoist.declEval (n+71) t c src.pushScope a0 .uint256 _ tm (Expiry.local48 _ _ "eligibleThrough" tm h.time rfl _ (Nat.le_succ _)) (by rfl)
  have ZE := Inv32FloorStart.zero (n+71) t c (arg r tm 0 0) er
  have ZP := Inv32FloorStart.zero (n+71) t c (withEth r tm 0 0 0) pr
  have C := Release.internal n c (withBoth r tm 0 0 0 0) a0 [er,pr] tm rfl fields clone h current
  have store : internalCallAssign (withBoth dst tm 0 0 0 0) [er,pr] [.word e,.word p] = pure (.normal (withBoth dst tm 0 0 e p)) := by checkpoint_write
  have same : Release.afterCall c (withBoth r tm 0 0 0 0) tm = withBoth dst tm 0 0 0 0 := by
    dsimp only [dst,Release.afterCall,Authority.post,Authority.bytes,Runtime.allocMemory,withBoth,withEth,arg,root,guarded,Runtime.withFrame,Runtime.pushScope,Runtime.declareLocal]
  change Stmt.eval (n+71) t c (withBoth r tm 0 0 0 0) (.internalCall [er,pr] Release.internalKey [.var a0]) = internalCallAssign (Release.afterCall c (withBoth r tm 0 0 0 0) tm) [er,pr] [.word e,.word p] at C
  rw [same] at C
  have cap : relCall.value.eval (n+72) t c (withBoth r tm 0 0 0 0) = pure (.normal (withBoth dst tm 0 0 e p)) := Inv32Internal.capture _ _ _ _ _ [er,pr] _ (C.trans store)
  have E := Inv32Temps.copy (n+71) t c (withBoth dst tm 0 0 e p) (withBoth dst tm e 0 e p) "ethAmount" er 0 e rfl rfl (by checkpoint_write)
  have P := Inv32Temps.copy (n+71) t c (withBoth dst tm e 0 e p) (withBoth dst tm e p e p) "repAmount" pr 0 p rfl rfl (by checkpoint_write)
  have B := Inv32Hoist.block (n+72) t c src (withBoth dst tm e p e p) _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ ZE).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ ZP).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ E).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] P).trans (by rw [Stmt.evalList])))))))
  have restore (rt : Runtime) (x y : Nat) : (withBoth rt tm x y x y).popScope=root rt tm x y := rfl
  rw [restore] at B
  exact B
def afterEligible (c : Context) (r : Runtime) (tm : Nat) :=
  if stored r.state .through<tm then Release.afterCall c r tm else r
def earned (s : State) (tm : Nat) (eth : Bool) := if stored s .through<tm then Preview.payout s tm eth else 0
theorem earnedPhase (n : Nat) (c : Context) (r : Runtime) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (clone : Authority.Clone c r) (tf : tm<2^48)
    (h : stored r.state .through<tm → Release.Ready r.state tm) (current : tm≤EnvWord.blockTimestamp.eval c) :
    eligible.value.eval (n+74) model.core.table c (root r tm 0 0) =
      pure (.normal (root (afterEligible c r tm) tm (earned r.state tm true) (earned r.state tm false))) := by
  let yes := decide (stored r.state .through<tm)
  let thenBody := (Inv03.Bodies.block (pay "eligibleThrough" "ethAmount" "repAmount")).value
  have test : eligibleCond.value.eval c (root r tm 0 0)=pure (.word (boolWord yes),root r tm 0 0) :=
    readEligible c _ tm rfl tf fields
  have br := Inv32Blocks.branch (n+73) model.core.table c (root r tm 0 0) eligibleCond.value thenBody .skip yes test
  apply br.trans
  by_cases ok : stored r.state .through<tm
  · rw [if_pos (show yes=true from decide_eq_true ok)]
    simp only [afterEligible,earned,if_pos ok]
    exact payEligible n c r tm fields clone (h ok) current
  · rw [if_neg (show ¬yes=true from by rw [show yes=false from decide_eq_false ok]; decide)]
    simp only [afterEligible,earned,if_neg ok]
    rw [Stmt.eval]
end Inv08.Checkpoint
