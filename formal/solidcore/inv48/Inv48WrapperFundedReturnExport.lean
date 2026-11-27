import Inv48WrapperFundedReturnShared
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WrapperFundedReturn
open Inv48.WholeQuote Inv48.QuoteMemory Inv48.ObservedMinimumHeap
open Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option maxRecDepth 1000000
set_option maxHeartbeats 20000000

theorem atSharedInvocation {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n helperFuel p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (folded : Inv48.PublicObservedQuote.Folded q (n+helperFuel+67) p a b fn rows) :
    ∃ s : Inv48.MinimumGuardSiteJoin.FundingTrace q (n+helperFuel+12) p a b fn rows,
    ∀
    (dC : Inv48.CollateralCloneStage.Deployment (bodyAt s).observed.collateral.joined.context (bodyAt s).observed.collateral.joined.caller)
    (_base : Inv48.CollateralReturnedMinimum.BaseDeployment (bodyAt s).observed.collateral.joined)
    (_envC : Inv48.MinimumSuccessWords.CanonicalOracle (bodyAt s).observed.collateral.joined.context (bodyAt s).observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) (bodyAt s).observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment (bodyAt s).observed.rep.joined.context (bodyAt s).observed.rep.joined.caller)
    (_envR : Inv48.MinimumSuccessWords.CanonicalOracle (bodyAt s).observed.rep.joined.context (bodyAt s).observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) (bodyAt s).observed.rep.joined.during)
    (multiplier minimum priority feeMul : Nat)
    (_haltWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "escalationHaltMultiplierBps" multiplier)
    (_minimumWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "minimumReportCollateral" minimum)
    (_priorityWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "initialReportPriorityFeeAttoEthPerGas" priority)
    (_feeWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "maxSettlementBaseFeeMultiplierBps" feeMul)
    (oracle : OracleInputs {q.context with checked := true}
      (Inv48.FundingMathTail.halted (Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal (Inv48.RequestPrologue.base q.runtime).nextMemory a p)
        (Inv48.RequestPrologue.base q.runtime).nextMemory a (Inv48.QuoteExec.repAmount a p) multiplier 0 0) rows)
,
    let id := (Inv48.RequestPrologue.base q.runtime).nextMemory
    let f := Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal id a p
    ∃ C R getter words last mt st baseFee,
      C≤a ∧ R*10^18≤a*p ∧ Inv48.QuoteExec.repAmount a p<Inv32Division.R ∧
      s.recovery.value = .returned getter words ∧ f.state = getter.state ∧
      s.quoteTrace = mt ++ st ∧
      Interaction.Executes (Stmt.evalList (n+helperFuel+65) Inv48.Source.model.core.table
        {q.context with checked := true} f tailCode) st (.ok (.normal last)) ∧
      last.popScope.popScope = s.post ∧
      baseFee=EnvWord.blockBasefee.eval {q.context with checked := true}+priority ∧
      baseFee<Inv32Division.R ∧ baseFee*feeMul/10000<Inv32Division.R ∧
      last.lookupLocal? "quote" = some (.memoryRef id) ∧
      s.post.loadMemory? id = some (tuple a (Inv48.QuoteExec.repAmount a p)
        (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100))
        ((a-minimum)*100) (baseFee*feeMul/10000)) := by
  obtain ⟨s,run⟩ := sharedInvocation q n helperFuel p a b fn rows linked hp ha hb folded
  refine ⟨s,?_⟩
  intro dC base envC dR envR multiplier minimum priority feeMul
    haltWord minimumWord priorityWord feeWord oracle
  exact atWrapperQuoteReturn q n helperFuel p a b fn rows s hp ha hb
    dC base envC dR envR run multiplier minimum priority feeMul
    haltWord minimumWord priorityWord feeWord oracle

#print axioms atSharedInvocation
end Inv48.WrapperFundedReturn
