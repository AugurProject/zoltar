import Inv48QuoteSegmentEventsRestrictions
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteSegmentEvents
open Inv48.CollateralMinimum
theorem aggregateObservedFold {α : Type} (escrowContext : Context) (escrowState : State) (escrowData : List SolidCore.Solidity.Source.Byte)
    (n : Nat) (c : Context) (r inner : Runtime) (saved : LocalEnv) (targets : List String) (final : Runtime)
    (entry : internalCallEnter? aggregateFn [] r = some (inner,saved))
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<Inv32Division.R)
    (boundary : inner.pushScope.pushScope.pushScope.state.envAccountCode c c.self=Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (d : Inv48.CollateralReadDecoded.Deployment {c with checked := true}
      (oracleStage inner.pushScope.pushScope.pushScope (Inv48.CloneRead.runtimeCode implementation universeBytes token)
        (Inv48.CloneRead.decode universeBytes)))
    (tr : Interaction.Transcript)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle {c with checked := true}
      (oracleStage inner.pushScope.pushScope.pushScope (Inv48.CloneRead.runtimeCode implementation universeBytes token)
        (Inv48.CloneRead.decode universeBytes)) d.root (Inv48.CollateralReadDecoded.bytes d) tr)
    (policyFuel childBudget parentBudget : Nat) (childRows parentRows : ScriptedResponder)
    (root : SolI α) (observed : Inv48.NestedResponder.Observation root)
    (computed : Inv48.ObservedEscrowResponder.observe parentBudget
      (Inv48.ObservedEscrowResponder.policy escrowContext escrowState escrowData
        policyFuel childBudget childRows parentRows) root = some observed)
    (before after : Interaction.Transcript)
    (split : observed.trace = before ++ tr ++ after)
    (run : Interaction.Executes (Stmt.eval (n+50) table c r (.internalCall targets aggregateKey [])) tr (.ok (.normal final))) :
    (Stmt.eval (n+50) table c r (.internalCall targets aggregateKey [])).runWith parentRows =
      .ok (.normal final) := by
  have restricted := aggregateCallRestricted escrowContext escrowState escrowData n c r inner saved
    targets final entry implementation universeBytes token hi hu ht cu ct selfWord boundary d tr env run
  exact Inv48.QuotePrefixPolicy.foldObservedPrefix escrowContext escrowState escrowData
    policyFuel childBudget parentBudget childRows parentRows root observed computed before tr after
    split (fun event member => (restricted event member).2) _ (Result.normal final) run
end Inv48.QuoteSegmentEvents
