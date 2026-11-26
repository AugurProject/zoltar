import Inv08CheckpointPublic
import Inv08Separation
open SolidCore.Solidity.Source
namespace Inv08.Checkpoint
def staleState (s : State) (now : Nat) :=
  if stored s .through<now then deferred (Release.post s now) (Preview.payout s now true) (Preview.payout s now false) else s
def finalState (s : State) (tm now : Nat) := staleState (eligibleState s tm) now
theorem finishedState (c : Context) (r : Runtime) (now : Nat) : (finish c r now).state=staleState r.state now := by
  unfold finish staleState
  split <;> rfl
theorem outputFields (c : Context) (s : State) (tm now : Nat) :
    (output c s tm now).storage=(finalState (Release.entryState c s) tm now).storage := by
  change (finish c (afterEligible c (Authority.post c (Release.baseRuntime c s)) tm) now).state.storage=_
  rw [finishedState,eligibleStateEq]
  rfl
/-- The six release writes leave both deferred balances available for the second phase. -/
theorem beforeDeferred (s : State) (tm : Nat) (eth : Bool) :
    stored (Release.post s tm) (deferredField eth)=stored s (deferredField eth) := by
  apply scalarCongr
  unfold Release.post Release.timestamped Release.repDebited Release.ethDebited Release.repCredited Release.ethCredited
  cases eth <;> repeat rw [frameField _ _ _ _ (by decide)]
end Inv08.Checkpoint
