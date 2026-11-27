import Inv48MinimumOperandTransportPrice
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumOperandTransport
open Inv48.Positive Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Retain the original observation and ABI finish unchanged. The new helper
witness is constructed at the dependent collateral cut of its recovered path. -/
structure Observation (n : Nat) (c : Context) (state : State) (p : Nat)
    (trace : Interaction.Transcript) (out : ABI.AbiCallResult) where
  suffix : Inv48.MinimumSuffixPath.Observation n c state p trace out
  collateral : Collateral suffix.path
  priceFit : p < Inv32Division.R

theorem extend (s : Inv48.RawMinimumResult.Observation (n+5) c state p trace out)
    (success : out.success = true)
    (data : List SolidCore.Solidity.Byte)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry data = .ok [.word p]) :
    Nonempty (Observation n c state p trace out) := by
  obtain ⟨suffix⟩ := Inv48.MinimumSuffixPath.extend s success
  obtain ⟨cut⟩ := collateral suffix.path suffix.original.body
  exact ⟨⟨suffix,cut,priceBound data p decoded⟩⟩

/-- Completed first block: the formula, h0, price and complete actual poststate
come from the helper selected by the ordered path, with no supplied runtime
invariant or word bound. REP and the rounded operand transport remain open. -/
theorem firstBlock (s : Observation n c state p trace out)
    (d : Inv48.CollateralCloneStage.Deployment s.collateral.joined.context s.collateral.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.collateral.joined)
    (env : CanonicalOracle s.collateral.joined.context s.collateral.joined.start d.root
      (Inv48.CollateralCloneStage.bytes d) s.collateral.joined.during) :
    ∃ response x C,
      OracleEvent s.collateral.joined.context s.collateral.joined.start d.root
        (Inv48.CollateralCloneStage.bytes d) s.collateral.joined.during response ∧
      response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      C = b.base + Inv03.ceilQuot x 100 ∧ C < Inv32Division.R ∧
      s.collateral.cut.callFinal = called
        (Inv48.Minima.tailState s.collateral.joined.tailStart x b.base).popScope.popScope.popScope
        (entryBase c state) p C ∧
      s.collateral.cut.copied = copied
        (Inv48.Minima.tailState s.collateral.joined.tailStart x b.base).popScope.popScope.popScope
        (entryBase c state) p C ∧
      s.suffix.path.collateral = collateralPost
        (Inv48.Minima.tailState s.collateral.joined.tailStart x b.base).popScope.popScope.popScope
        (entryBase c state) p C ∧
      s.suffix.path.collateral.lookupLocal? h0 = some (.word C) ∧
      s.suffix.path.collateral.lookupLocal? "proposedRepPerEthPrice" = some (.word p) :=
  finishCollateral s.suffix.path s.collateral s.priceFit s.suffix.original.positive d b env

#print axioms extend
#print axioms firstBlock
end Inv48.MinimumOperandTransport
