import Inv48QuoteMinimumEventsQuote
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteMinimumEvents
open Inv48.QuoteSegmentEvents

def collateralTrace (s : Inv48.CollateralReturnedMinimum.Joined trace out) :=
  s.baseTrace ++ (s.prefixTrace ++ (s.during ++ (s.oracleTail ++ (s.aggregateFinish ++
    (s.copyTail ++ (s.sourceTail ++ s.collateralFinish))))))
def repTrace (s : Inv48.RepReturnedMinimum.Joined trace out) :=
  s.prefixTrace ++ (s.during ++ (s.tail ++ s.finishTrace))

def Restricted (tr : Interaction.Transcript) : Prop := ∀ event ∈ tr, ResourceOrStatic event.query

theorem singletonRestricted (c : Context) (r : Runtime) (root : Nat) (data : List Source.Byte)
    (response : Answer (.external (snapshotWorld c r.state)
      (.call (buildCallRequest c .staticcall root data 0 none)))) :
    Restricted [{query := (.external (snapshotWorld c r.state)
      (.call (buildCallRequest c .staticcall root data 0 none))),answer := response}] := by
  intro event member
  have eq := List.mem_singleton.mp member
  subst event
  exact .staticcall _ _ rfl

theorem repRestricted (s : Inv48.RepReturnedMinimum.Joined trace out)
    (d : Inv48.RepReturnedMinimum.Deployment s.context s.caller)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root
      (Inv48.RepReturnedMinimum.bytes d) s.during) : Restricted (repTrace s) := by
  obtain ⟨response,x,eq,_⟩ := repHelperEvents s d env
  unfold repTrace
  rw [eq]
  exact singletonRestricted _ _ _ _ response

theorem collateralRestricted (s : Inv48.CollateralReturnedMinimum.Joined trace out)
    (d : Inv48.CollateralCloneStage.Deployment s.context s.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root
      (Inv48.CollateralCloneStage.bytes d) s.during) : Restricted (collateralTrace s) := by
  obtain ⟨response,x,eq,_⟩ := collateralHelperEvents s d b env
  unfold collateralTrace
  rw [eq]
  exact singletonRestricted _ _ _ _ response

/-- Query exclusion is a consequence of recovered event kind; it is not an input. -/
theorem restrictedExcludes (tr : Interaction.Transcript) (restricted : Restricted tr)
    (c : Context) (state : State) (data : List Source.Byte) :
    ∀ event ∈ tr, event.query ≠ Inv48.ObservedEscrowResponder.query c state data := by
  intro event member
  exact excludes c state data _ (restricted event member)

/-- Apply classification to the helpers of the actual quote minimum invocation. -/
theorem quoteHelpersRestricted (s : QuoteRecovery n c physical p a bounty trace out)
    (dC : Inv48.CollateralCloneStage.Deployment s.collateral.context s.collateral.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.collateral)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle s.collateral.context s.collateral.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.collateral.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.rep.context s.rep.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle s.rep.context s.rep.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.rep.during) :
    Restricted (collateralTrace s.collateral) ∧ Restricted (repTrace s.rep) :=
  ⟨collateralRestricted s.collateral dC b envC,repRestricted s.rep dR envR⟩
end Inv48.QuoteMinimumEvents
