import Inv08ReleasePublic
import Inv08ReleaseExecution
import Inv08Authority
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv08.Release

/-- External execution of release in a bound clone, including the caller and
time checks, binary search, both quotients and all six storage writes. -/
theorem release (n : Nat) (c : Context) (s : State) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields)
    (free : c.value=0) (clone : Authority.Clone c (baseRuntime c s))
    (h : Ready s tm) (current : tm≤EnvWord.blockTimestamp.eval c) :
    TypeCheck.CheckedContract.callTargetWithContext? (n+70) model (.name "release") c s [.word tm] =
      some (.returned (outputState c s tm) [.word (Preview.payout s tm true),.word (Preview.payout s tm false)]) := by
  let r := guarded (baseRuntime c s) tm 0 0
  have caller := Authority.authorized (n+27) c r clone
  have duration := Authority.initialized (n+27) c (Authority.post c r) fields h.duration
  exact publicFromBody n c s tm free (execute n c (baseRuntime c s) tm fields (readyOnEntry c s tm h)
    current (clockWord c) caller duration)

end Inv08.Release
