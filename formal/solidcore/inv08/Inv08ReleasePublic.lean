import Inv08ReleaseQuoteCall
import Inv08AuthorityBytes
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Release
/-- SolidCore rebases the self balance to the call environment on external entry. -/
def entryState (c : Context) (s : State) : State :=
  { s with
    selfBalance := Shared.addWord (Shared.Account.balanceAt c.accountBalances c.self) c.value
    worldMutatedSinceAdoption := true }
def baseRuntime (c : Context) (s : State) : Runtime := {state:=entryState c s,locals:=[]}
def outputState (c : Context) (s : State) (tm : Nat) :=
  {post (entryState c s) tm with constructorOutput? := none}

theorem clockWord (c : Context) : EnvWord.blockTimestamp.eval c < R :=
  Nat.mod_lt _ (by decide)

theorem readyOnEntry (c : Context) (s : State) (tm : Nat) (h : Ready s tm) :
    Ready (entryState c s) tm := by
  exact ⟨⟨h.time,h.forward,h.ordered,h.settled,h.sorted,h.rateOrder,h.fits,h.cursors,h.duration⟩,h.funded,h.word⟩

private theorem putCongr (s t : State) (k : Field) (v : Nat) (same : s.storage=t.storage) :
    (s.storeFieldWord k.field v).storage = (t.storeFieldWord k.field v).storage := by
  unfold State.storeFieldWord State.storeFieldSlot State.loadFieldSlot
  simp only [Field.field,Bool.false_eq_true,if_false,State.storeSlot,State.loadSlot,same]
  split <;> rfl

theorem outputStorage (c : Context) (s : State) (tm : Nat) :
    (outputState c s tm).storage = (post s tm).storage := by
  change ((timestamped (entryState c s) tm).storeFieldWord Field.settled.field (Preview.q (entryState c s) tm)).storage =
    ((timestamped s tm).storeFieldWord Field.settled.field (Preview.q s tm)).storage
  have qsame : Preview.q (entryState c s) tm = Preview.q s tm := rfl
  have csame (eth : Bool) : cursor (entryState c s) tm eth = cursor s tm eth := rfl
  have lsame (eth : Bool) : leftover (entryState c s) tm eth = leftover s tm eth := rfl
  rw [qsame]
  apply putCongr
  unfold timestamped; apply putCongr
  unfold repDebited; rw [lsame]; apply putCongr
  unfold ethDebited; rw [lsame]; apply putCongr
  unfold repCredited; rw [csame]; apply putCongr
  unfold ethCredited; rw [csame]; apply putCongr
  rfl

set_option maxHeartbeats 1000000 in
theorem publicFromBody (n : Nat) (c : Context) (s : State) (tm : Nat) (free : c.value=0)
    (eval : let r := baseRuntime c s
      let e := Preview.payout (entryState c s) tm true
      let p := Preview.payout (entryState c s) tm false
      body.value.eval (n+70) model.core.table c (r.withFrame (frame tm 0 0)) =
        pure (.normal {(Authority.post c r).withFrame (frame tm e p) with state:=post (entryState c s) tm})) :
    TypeCheck.CheckedContract.callTargetWithContext? (n+70) model (.name "release") c s [.word tm] =
      some (.returned (outputState c s tm) [.word (Preview.payout (entryState c s) tm true),.word (Preview.payout (entryState c s) tm false)]) := by
  let r := baseRuntime c s
  let e := Preview.payout (entryState c s) tm true
  let p := Preview.payout (entryState c s) tm false
  let dst := {(Authority.post c r).withFrame (frame tm e p) with state:=post (entryState c s) tm}
  have X := eval
  change Stmt.eval _ _ _ _ body.value = pure (.normal dst) at X
  rw [←bodyFromSource] at X
  have noValue : fn.acceptsValue c.value=true := by rw [free]; simp [FunctionDef.acceptsValue,wordEq]
  have run : fn.evalBodyEntry (n+70) model.core.table c s [.word tm]=some (pure (.normal dst)) := by
    unfold FunctionDef.evalBodyEntry
    rw [noValue,initial]; exact congrArg some X
  have outputs : fn.collectReturns dst = .ok [.word e,.word p] := by
    unfold FunctionDef.collectReturns
    rw [results]
    simp [collectReturnBindings,collectReturnBindings.collect,Inv32Library.decl,dst,Runtime.lookupLocal?,
      Runtime.withFrame,frame,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,Bind.bind,Except.bind]
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [dispatch]
  change fn.call? _ _ _ _ _ = _
  unfold FunctionDef.call? FunctionDef.call
  rw [run]
  change some (fn.callBodyResult s (.normal dst)) = _
  simp only [FunctionDef.callBodyResult,outputs,List.map_cons,List.map_nil,Value.untagFixedBytes]
  rfl
end Inv08.Release
