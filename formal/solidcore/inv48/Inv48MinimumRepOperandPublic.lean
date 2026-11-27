import Inv48MinimumRepOperandRounded
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumRepOperand
open Inv48.Positive Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

structure Observation (n : Nat) (c : Context) (state : State) (p : Nat)
    (trace : Interaction.Transcript) (out : ABI.AbiCallResult) where
  source : Inv48.MinimumOperandTransport.Observation n c state p trace out
  rep : Rep source.suffix.path

 theorem extend (s : Inv48.MinimumOperandTransport.Observation n c state p trace out) :
    Nonempty (Observation n c state p trace out) := by
  obtain ⟨rep⟩ := rep s.suffix.path s.suffix.original.body
  exact ⟨⟨s,rep⟩⟩

/-- Both certificates are instantiated at cuts of the retained ordered path.
Numeric locals are conclusions; the premises supply only deployment/oracle data. -/
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
      s.source.suffix.path.rep = repPost
        (Inv48.RepReturnedMinimum.tailState s.rep.joined.final y).popScope.popScope.popScope
        (entryBase c state) p C R ∧
      s.source.suffix.path.rep.lookupLocal? h0 = some (.word C) ∧
      s.source.suffix.path.rep.lookupLocal? h1 = some (.word R) ∧
      s.source.suffix.path.rep.lookupLocal? "proposedRepPerEthPrice" = some (.word p) ∧
      Expr.evalRefArgList c s.source.suffix.rounded.caller [.var a0,.var a1,.var a2,.var a3] =
        pure ([.word R,.word (10^18),.word p,.word 1],s.source.suffix.rounded.caller) ∧
      s.source.suffix.rounded.caller.lookupLocal? h0 = some (.word C) := by
  obtain ⟨response,x,C,event,success,fitX,decoded,formula,fitC,callEq,copyEq,postEq,H,P⟩ :=
    Inv48.MinimumOperandTransport.firstBlock s.source d b env
  obtain ⟨repResponse,y,R,repEvent,repSuccess,fitY,repDecoded,repFormula,fitR,
    repCallEq,repCopyEq,repPostEq,HC,HR,HP⟩ := finishRep s.source.suffix.path s.rep postEq rd renv
  have args := operands s.source.suffix.path s.source.suffix.rounded repPostEq s.source.priceFit fitR
  exact ⟨response,x,C,repResponse,y,R,event,success,fitX,decoded,formula,fitC,
    repEvent,repSuccess,fitY,repDecoded,repFormula,fitR,repPostEq,HC,HR,HP,args.1,args.2⟩

#print axioms extend
#print axioms transport
end Inv48.MinimumRepOperand
