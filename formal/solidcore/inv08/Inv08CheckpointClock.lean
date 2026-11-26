import Inv08CheckpointCast
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Checkpoint
def hoist (r : Runtime) (v : Nat) := r.pushScope.declareLocal "_sol_hoist_0" (.word v)
def clockArg (r : Runtime) (v now : Nat) := (hoist r v).pushScope.declareLocal a0 (.word now)
def clockTemps (r : Runtime) (v now copy : Nat) := (clockArg r v now).declareLocal tr (.word copy)
theorem clockReads (c : Context) (r : Runtime) : Inv40.Reads c r (.env .blockTimestamp) (EnvWord.blockTimestamp.eval c) := by
  intro fuel enough
  cases fuel with
  | zero => change 1≤0 at enough; omega
  | succ n => simp [Expr.evalFuel]
macro "clock_write" : tactic => `(tactic|
  simp [clockTemps,clockArg,hoist,tr,a0,internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
    Runtime.lookupLocal?,Runtime.assignLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,
    LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem clock (n : Nat) (c : Context) (r : Runtime) (now : Nat)
    (time : EnvWord.blockTimestamp.eval c=now) (fit : now<2^48) :
    castClock.value.eval (n+6) model.core.table c (hoist r 0)=pure (.normal (hoist r now)) := by
  let t := model.core.table
  have env := clockReads c (hoist r 0).pushScope
  rw [time] at env
  have A := Inv32Hoist.declEval (n+4) t c (hoist r 0).pushScope a0 .uint256 _ now
    (ReleaseQuote.readClean env (lt_trans fit (by decide)) _ (Nat.le_succ _)) (by rfl)
  have Z := Inv32FloorStart.zero (n+4) t c (clockArg r 0 now) tr
  have C := castCall n c (clockTemps r 0 now 0) a0 [tr] now rfl fit
  have store : internalCallAssign (clockTemps r 0 now 0) [tr] [.word now]=pure (.normal (clockTemps r 0 now now)) := by clock_write
  have cap := Inv32Internal.capture _ _ _ _ _ [tr] _ (C.trans store)
  have V := Inv32Temps.copy (n+4) t c (clockTemps r 0 now now) (clockTemps r now now now) "_sol_hoist_0" tr 0 now rfl rfl
    (by clock_write)
  exact Inv32Hoist.block _ _ _ _ (clockTemps r now now now) _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] V).trans (by rw [Stmt.evalList])))))
end Inv08.Checkpoint
