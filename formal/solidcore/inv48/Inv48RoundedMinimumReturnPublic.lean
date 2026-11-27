import Inv48RoundedMinimumReturnABI
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RoundedMinimumReturn
open Inv48.Positive Inv48.MinimumSuccessWords Inv48.MinimumRepOperand
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem transport (s : Observation n c state p trace out)
    (d : Inv48.CollateralCloneStage.Deployment s.source.collateral.joined.context s.source.collateral.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.source.collateral.joined)
    (env : CanonicalOracle s.source.collateral.joined.context s.source.collateral.joined.start d.root
      (Inv48.CollateralCloneStage.bytes d) s.source.collateral.joined.during)
    (rd : Inv48.RepReturnedMinimum.Deployment s.rep.joined.context s.rep.joined.caller)
    (renv : CanonicalOracle s.rep.joined.context s.rep.joined.start rd.root
      (Inv48.RepReturnedMinimum.bytes rd) s.rep.joined.during) :
    ∃ collateralResponse x C repResponse y R,
      OracleEvent s.source.collateral.joined.context s.source.collateral.joined.start d.root
        (Inv48.CollateralCloneStage.bytes d) s.source.collateral.joined.during collateralResponse ∧
      collateralResponse.success = true ∧ x < Inv32Division.R ∧
      Inv48.ExposureComparison.decoded collateralResponse x ∧
      C = b.base + Inv03.ceilQuot x 100 ∧ C < Inv32Division.R ∧
      OracleEvent s.rep.joined.context s.rep.joined.start rd.root
        (Inv48.RepReturnedMinimum.bytes rd) s.rep.joined.during repResponse ∧
      repResponse.success = true ∧ y < Inv32Division.R ∧
      Inv48.ExposureComparison.decoded repResponse y ∧
      R = Inv03.ceilQuot y 100 ∧ R < Inv32Division.R ∧
      Inv03.ceilQuot (R*10^18) p < Inv32Division.R ∧
      out.output = ABI.encodeWord (max C (Inv03.ceilQuot (R*10^18) p)) ∧
      (∀ amount, max C (Inv03.ceilQuot (R*10^18) p) ≤ amount ↔
        C ≤ amount ∧ R*10^18 ≤ amount*p) := by
  obtain ⟨response,x,C,repResponse,y,R,event,success,fitX,decoded,formula,fitC,
    repEvent,repSuccess,fitY,repDecoded,repFormula,fitR,repPostEq,HC,HR,HP,args,H⟩ :=
    Inv48.MinimumRepOperand.transport s d b env rd renv
  obtain ⟨final,fitQ,callEq,copyEq,finalEq,valueEq⟩ := finish
    s.source.suffix.path s.source.suffix.rounded repPostEq s.source.priceFit fitC fitR
    s.source.suffix.original.positive
  have resultEq : s.source.suffix.original.result =
      .returned final.popScope.popScope [.word (max C (Inv03.ceilQuot (R*10^18) p))] := by
    rw [s.source.suffix.path.originalResult,valueEq]
    rfl
  have fv : max C (Inv03.ceilQuot (R*10^18) p) < Inv32Division.R := max_lt fitC fitQ
  have finished := s.source.suffix.original.finish
  rw [resultEq] at finished
  have encoded := abi Inv48.Source.model.core Inv48.PositiveABI.entry
    Inv48.PositiveABI.metadata.2.2.2.2 state final.popScope.popScope _ fv out finished
  exact ⟨response,x,C,repResponse,y,R,event,success,fitX,decoded,formula,fitC,
    repEvent,repSuccess,fitY,repDecoded,repFormula,fitR,fitQ,encoded,
    fun amount => Inv48.sufficient C R p amount s.source.suffix.original.positive⟩

#print axioms transport
end Inv48.RoundedMinimumReturn
