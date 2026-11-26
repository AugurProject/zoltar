import Inv08ReleaseEffects
import Inv08ReleaseBody
open SolidCore.Solidity.Source Inv03.Bodies
namespace Inv08.Release

def guarded (r : Runtime) (tm a b : Nat) := (r.withFrame (frame tm a b)).pushScope.pushScope.pushScope
def root (r : Runtime) (tm a b : Nat) := (guarded r tm a b).pushScope
def withId (r : Runtime) (tm a b id : Nat) := (root r tm a b).declareLocal "expiredId" (.word id)
def withArg (r : Runtime) (tm a b id : Nat) := (withId r tm a b id).pushScope.declareLocal a0 (.word tm)
def withE (r : Runtime) (tm a b id e : Nat) := (withArg r tm a b id).declareLocal re (.word e)
def withP (r : Runtime) (tm a b id e p : Nat) := (withE r tm a b id e).declareLocal rp (.word p)
def marked (r : Runtime) (tm a b id e p i : Nat) := (withP r tm a b id e p).declareLocal ri (.word i)
macro "release_write" : tactic => `(tactic|
  simp [marked,withP,withE,withArg,withId,root,guarded,frame,a0,re,rp,ri,internalCallAssign,
    Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.lookupLocal?,
    Runtime.declareLocal,Runtime.withFrame,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,
    Frame.lookup?,Frame.assign?,Value.coerceLike?])
set_option maxHeartbeats 1200000 in
theorem quoteRuns (n : Nat) (c : Context) (r : Runtime) (tm : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (h : Ready r.state tm) :
    let e := Preview.payout r.state tm true
    let p := Preview.payout r.state tm false
    let id := Preview.q r.state tm
    quote.value.eval (n+65) model.core.table c (withId r tm 0 0 0) = pure (.normal (withId r tm e p id)) := by
  let t := model.core.table
  let id := Preview.q r.state tm
  let e := Preview.payout r.state tm true
  let p := Preview.payout r.state tm false
  let src := withId r tm 0 0 0
  let rt := marked r tm
  have A := Inv32Hoist.declEval (n+63) t c src.pushScope a0 .uint256 _ tm (Expiry.local48 _ _ "until" tm h.time rfl _ (Nat.le_succ _)) (by rfl)
  have ZE := Inv32FloorStart.zero (n+63) t c (withArg r tm 0 0 0) re
  have ZP := Inv32FloorStart.zero (n+63) t c (withE r tm 0 0 0 0) rp
  have ZI := Inv32FloorStart.zero (n+63) t c (withP r tm 0 0 0 0 0) ri
  have C := Preview.call n c (rt 0 0 0 0 0 0) a0 [re,rp,ri] tm rfl fields h.toReady
  have store : internalCallAssign (rt 0 0 0 0 0 0) [re,rp,ri] [.word e,.word p,.word id] = pure (.normal (rt 0 0 0 e p id)) := by
    dsimp only [rt]; release_write
  have cap := Inv32Internal.capture _ _ _ _ _ [re,rp,ri] _ (C.trans store)
  have E := Inv32Temps.copy (n+63) t c (rt 0 0 0 e p id) (rt e 0 0 e p id) "ethAmount" re 0 e rfl rfl
    (by dsimp only [rt]; release_write)
  have P := Inv32Temps.copy (n+63) t c (rt e 0 0 e p id) (rt e p 0 e p id) "repAmount" rp 0 p rfl rfl
    (by dsimp only [rt]; release_write)
  have I := Inv32Temps.copy (n+63) t c (rt e p 0 e p id) (rt e p id e p id) "expiredId" ri 0 id rfl rfl
    (by dsimp only [rt]; release_write)
  exact Inv32Hoist.block _ _ _ _ (rt e p id e p id) _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ ZE).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ ZP).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ ZI).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ E).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] I).trans (by rw [Stmt.evalList])))))))))

theorem currentTime (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm : Nat)
    (current : tm ≤ EnvWord.blockTimestamp.eval c) (word : EnvWord.blockTimestamp.eval c < Inv32Division.R)
    (found : r.lookupLocal? "until"=some (.word tm)) :
    validTime.value.eval (n+1) t c r=pure (.normal r) := by
  have timeWord := lt_of_le_of_lt current word
  have lhs := ReleaseQuote.readClean (localReads c r _ _ found) timeWord
  have env : Inv40.Reads c r (.env .blockTimestamp) (EnvWord.blockTimestamp.eval c) := by
    intro fuel enough
    cases fuel with
    | zero => change 1≤0 at enough; omega
    | succ n => simp [Expr.evalFuel]
  have rhs := ReleaseQuote.readClean env word
  have op : BinaryOp.apply c.checked .le (.word tm) (.word (EnvWord.blockTimestamp.eval c)) = .ok (.word 1) := by
    simpa [current] using Inv32WideGuards.leWord _ _ timeWord word
  exact Inv32QuoteGuard.requireEval _ _ _ _ _ true "Future fee checkpoint"
    (ReleaseQuote.binary lhs rhs .le (by intro h; cases h) (by intro h; cases h) op _ (Nat.le_succ _))

theorem afterGuard (n : Nat) (c : Context) (r : Runtime) (tm : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (h : Ready r.state tm) (current : tm ≤ EnvWord.blockTimestamp.eval c) (word : EnvWord.blockTimestamp.eval c < Inv32Division.R) :
    let e := Preview.payout r.state tm true
    let p := Preview.payout r.state tm false
    captured.value.eval (n+67) model.core.table c (guarded r tm 0 0) =
      pure (.normal {guarded r tm e p with state:=post r.state tm}) := by
  let t := model.core.table
  let id := Preview.q r.state tm
  let e := Preview.payout r.state tm true
  let p := Preview.payout r.state tm false
  let rt := withId r tm e p id
  have T := currentTime (n+64) t c (root r tm 0 0) tm current word rfl
  have D := Inv32FloorStart.zero (n+64) t c (root r tm 0 0) "expiredId"
  have Q := quoteRuns n c r tm fields h
  have E := effects (n+64) t c rt tm h fields rfl rfl (by intro eth; cases eth <;> rfl)
  have B := Inv32Hoist.block _ _ _ (guarded r tm 0 0) {rt with state:=post r.state tm} _
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ T).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ D).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Q).trans E)))
  exact Inv32Internal.capture _ _ _ _ _ _ _ B
end Inv08.Release
