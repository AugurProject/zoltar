import Inv48ReportingGuardFrameProof
import Inv48BountyGuardFrameResult
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.RequestPrologue Inv48.EscrowJoin Inv48.EscrowPrefix
namespace Inv48.GuardArgsFrame
theorem allGuardsPrefix (n : Nat) (c : Context) (raw initialRuntime savedRuntime final : Runtime)
    (fn : InternalFunction) (saved : LocalEnv) (s p a b g : Nat)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (callEntry : internalCallEnter? fn (args s p a b g) raw = some (initialRuntime,saved))
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) (hg : g < 2^32)
    (cleanupTrace guardTrace : Interaction.Transcript)
    (cleanupRun : ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c
      initialRuntime.pushScope cleanup) cleanupTrace (.normal savedRuntime))
    (guardRun : ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c
      savedRuntime.pushScope guards) guardTrace (.normal final)) :
    saved = raw.locals ∧ final.locals = []::[]::requestFrame s p a b g::[] ∧
      Lookups final p a b := by
  apply localPrefix <;> first | assumption | apply Inv48.ReportingGuardFrame.oracleFrame | apply Inv48.BountyGuardFrame.helperFrame
end Inv48.GuardArgsFrame
#print axioms Inv48.GuardArgsFrame.allGuardsPrefix
