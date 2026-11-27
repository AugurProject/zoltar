import Inv48RawMinimumResultObservation
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RawMinimumResult
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Actual returned helper words, including the exact saved-local assignments.
These bounds are consequences of successful execution, not arithmetic budgets. -/
theorem returnedHelpers (s : Observation fuel c state p trace out)
    (dC : Inv48.CollateralCloneStage.Deployment s.collateral.context s.collateral.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.collateral)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle s.collateral.context s.collateral.start
      dC.root (Inv48.CollateralCloneStage.bytes dC) s.collateral.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.rep.context s.rep.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle s.rep.context s.rep.start
      dR.root (Inv48.RepReturnedMinimum.bytes dR) s.rep.during) :
    ∃ responseC responseR x y C R,
      Inv48.MinimumSuccessWords.OracleEvent s.collateral.context s.collateral.start dC.root
        (Inv48.CollateralCloneStage.bytes dC) s.collateral.during responseC ∧
      responseC.success = true ∧ x < Inv32Division.R ∧
      Inv48.ExposureComparison.decoded responseC x ∧
      Inv48.MinimumSuccessWords.OracleEvent s.rep.context s.rep.start dR.root
        (Inv48.RepReturnedMinimum.bytes dR) s.rep.during responseR ∧
      responseR.success = true ∧ y < Inv32Division.R ∧
      Inv48.ExposureComparison.decoded responseR y ∧
      C = b.base + Inv03.ceilQuot x 100 ∧ R = Inv03.ceilQuot y 100 ∧
      C < Inv32Division.R ∧ R < Inv32Division.R ∧
      s.collateral.sourceValue = .returned
        (Inv48.Minima.tailState s.collateral.tailStart x b.base) [.word C] ∧
      ({ (Inv48.Minima.tailState s.collateral.tailStart x b.base).popScope.popScope.popScope
        with locals := s.collateral.collateralSaved }).assignNamedValuesRef?
        [Inv48.Positive.ret1] [.word C] = some s.collateral.publicFinal ∧
      s.rep.value = .returned (Inv48.RepReturnedMinimum.tailState s.rep.final y) [.word R] ∧
      ({ (Inv48.RepReturnedMinimum.tailState s.rep.final y).popScope.popScope.popScope
        with locals := s.rep.saved }).assignNamedValuesRef?
        [Inv48.Positive.ret2] [.word R] = some s.rep.publicFinal ∧
      s.collateral.sourceTail = [] ∧ s.collateral.collateralFinish = [] ∧
      s.rep.tail = [] ∧ s.rep.finishTrace = [] ∧
      (∀ amount, max C (Inv03.ceilQuot (R * 10^18) p) ≤ amount ↔
        C ≤ amount ∧ R * 10^18 ≤ amount * p) := by
  obtain ⟨responseC,x,eventC,successC,fitX,decodedC,fitC,returnedC,assignedC,tailC,finishC⟩ :=
    s.collateralCertificate dC b envC
  obtain ⟨responseR,y,eventR,successR,fitY,decodedR,fitR,returnedR,assignedR,tailR,finishR⟩ :=
    s.repCertificate dR envR
  refine ⟨responseC,responseR,x,y,b.base + Inv03.ceilQuot x 100,Inv03.ceilQuot y 100,
    eventC,successC,fitX,decodedC,eventR,successR,fitY,decodedR,rfl,rfl,fitC,fitR,
    returnedC,assignedC,returnedR,assignedR,tailC,finishC,tailR,finishR,?_⟩
  intro amount
  exact Inv48.sufficient _ _ _ _ s.positive

#print axioms returnedHelpers
end Inv48.RawMinimumResult
