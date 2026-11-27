import Inv48MinimumFullTraceBody
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
open Inv48.QuoteMinimumEvents
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def collateralQuery (s : Inv48.CollateralReturnedMinimum.Joined tr out)
    (d : Inv48.CollateralCloneStage.Deployment s.context s.caller) : Query :=
  .external (snapshotWorld s.context s.start.state)
    (.call (buildCallRequest s.context .staticcall d.root (Inv48.CollateralCloneStage.bytes d) 0 none))

def repQuery (s : Inv48.RepReturnedMinimum.Joined tr out)
    (d : Inv48.RepReturnedMinimum.Deployment s.context s.caller) : Query :=
  .external (snapshotWorld s.context s.start.state)
    (.call (buildCallRequest s.context .staticcall d.root (Inv48.RepReturnedMinimum.bytes d) 0 none))

/-- Exact ordered queries of the actual body, rather than a classification
premise or a union of independently selected helper sites. -/
theorem bodyPair (p : BodyRecovery fuel c r tr out)
    (dC : Inv48.CollateralCloneStage.Deployment p.collateral.context p.collateral.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment p.collateral)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle p.collateral.context p.collateral.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) p.collateral.during)
    (dR : Inv48.RepReturnedMinimum.Deployment p.rep.context p.rep.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle p.rep.context p.rep.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) p.rep.during) :
    ∃ ac : Answer (collateralQuery p.collateral dC), ∃ ar : Answer (repQuery p.rep dR),
      tr = [{query := collateralQuery p.collateral dC,answer := ac},
        {query := repQuery p.rep dR,answer := ar}] := by
  obtain ⟨ac,x,ceq,_⟩ := collateralHelperEvents p.collateral dC b envC
  obtain ⟨ar,y,req,_⟩ := repHelperEvents p.rep dR envR
  refine ⟨ac,ar,?_⟩
  exact p.split.trans (congrArg₂ List.append ceq req)

theorem bodyRestricted (p : BodyRecovery fuel c r tr out)
    (dC : Inv48.CollateralCloneStage.Deployment p.collateral.context p.collateral.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment p.collateral)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle p.collateral.context p.collateral.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) p.collateral.during)
    (dR : Inv48.RepReturnedMinimum.Deployment p.rep.context p.rep.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle p.rep.context p.rep.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) p.rep.during) : Restricted tr := by
  intro event member
  rw [p.split] at member
  rcases List.mem_append.mp member with left | right
  · exact collateralRestricted p.collateral dC b envC event left
  · exact repRestricted p.rep dR envR event right

/-- The escrow CALL is excluded for every escrow snapshot and calldata. -/
theorem bodyExcludes (p : BodyRecovery fuel c r tr out)
    (dC : Inv48.CollateralCloneStage.Deployment p.collateral.context p.collateral.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment p.collateral)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle p.collateral.context p.collateral.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) p.collateral.during)
    (dR : Inv48.RepReturnedMinimum.Deployment p.rep.context p.rep.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle p.rep.context p.rep.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) p.rep.during)
    (escrowContext : Context) (state : State) (data : List Source.Byte) :
    ∀ event ∈ tr, event.query ≠ Inv48.ObservedEscrowResponder.query escrowContext state data :=
  restrictedExcludes tr (bodyRestricted p dC b envC dR envR) escrowContext state data
end Inv48.MinimumFullTrace
