import Inv48WrapperFundedReturnCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WrapperFundedReturn
open Inv48.WholeQuote Inv48.QuoteMemory Inv48.ObservedMinimumHeap
open Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option maxRecDepth 1000000
set_option maxHeartbeats 20000000

/-- The body provenance is recovered from this funding trace, not assumed. -/
noncomputable def bodyAt {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    {q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out}
    {n p a b : Nat} {fn : InternalFunction} {rows : ScriptedResponder}
    (s : Inv48.MinimumGuardSiteJoin.FundingTrace q n p a b fn rows) :=
  Classical.choice (Inv48.ObservedMinimumHeap.recoverAtFundingCut q n p a b fn rows s)

/-- Retain the actual execution and funding recovery from one shared invocation.
Both RawEscrowSchedule wrappers supply exactly this folded quote index. -/
theorem sharedInvocation {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n helperFuel p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (folded : Inv48.PublicObservedQuote.Folded q (n+helperFuel+67) p a b fn rows) :
    ∃ s : Inv48.MinimumGuardSiteJoin.FundingTrace q (n+helperFuel+12) p a b fn rows,
      Interaction.Executes (Stmt.eval (n+helperFuel+67) Inv48.Source.model.core.table
        {q.context with checked := true} (entry (Inv48.RequestPrologue.base q.runtime) p a b)
        bodyP.value) s.quoteTrace (.ok (.normal s.post)) := by
  obtain ⟨post,bt,aft,split,aligned,body,run,cont⟩ := folded
  have shape := Inv48.WholeQuote.actualBody
  rw [linked] at shape
  have eq : fn.body = Inv48.WholeQuote.bodyP.value := Option.some.inj shape
  rw [eq] at body run
  obtain ⟨recovery⟩ := Inv48.MinimumGuardSiteJoin.fromQuote (n+helperFuel+52)
    _ _ post p a b hp ha hb bt body
  exact ⟨⟨post,bt,aft,split,recovery,aligned,run,cont⟩,body⟩

/-- Shared by the simple and operations wrappers: their recovered quote runs at
n+helperFuel+67 and their FundingTrace at n+helperFuel+12. No fuel lowering,
independent invocation, or replacement transcript is needed. -/
theorem atWrapperQuoteReturn {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n helperFuel p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (s : Inv48.MinimumGuardSiteJoin.FundingTrace q (n+helperFuel+12) p a b fn rows)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (dC : Inv48.CollateralCloneStage.Deployment (bodyAt s).observed.collateral.joined.context (bodyAt s).observed.collateral.joined.caller)
    (base : Inv48.CollateralReturnedMinimum.BaseDeployment (bodyAt s).observed.collateral.joined)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle (bodyAt s).observed.collateral.joined.context (bodyAt s).observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) (bodyAt s).observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment (bodyAt s).observed.rep.joined.context (bodyAt s).observed.rep.joined.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle (bodyAt s).observed.rep.joined.context (bodyAt s).observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) (bodyAt s).observed.rep.joined.during)
    (run : Interaction.Executes (Stmt.eval (n+helperFuel+67) Inv48.Source.model.core.table
      {q.context with checked := true} (entry (Inv48.RequestPrologue.base q.runtime) p a b)
      bodyP.value) s.quoteTrace (.ok (.normal s.post)))
    (multiplier minimum priority feeMul : Nat)
    (haltWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "escalationHaltMultiplierBps" multiplier)
    (minimumWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "minimumReportCollateral" minimum)
    (priorityWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "initialReportPriorityFeeAttoEthPerGas" priority)
    (feeWord : PhysicalWord {q.context with checked := true} s.recovery.cut.minimumFinal
      "maxSettlementBaseFeeMultiplierBps" feeMul)
    (oracle : OracleInputs {q.context with checked := true}
      (Inv48.FundingMathTail.halted (Inv48.ObservedFundedCell.funded s.recovery.cut.minimumFinal (Inv48.RequestPrologue.base q.runtime).nextMemory a p)
        (Inv48.RequestPrologue.base q.runtime).nextMemory a (Inv48.QuoteExec.repAmount a p) multiplier 0 0) rows)
 :
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
  simpa only [Nat.add_assoc] using
    atQuoteReturn q (n+helperFuel) p a b fn rows s (bodyAt s) hp ha hb
      dC base envC dR envR run multiplier minimum priority feeMul
      haltWord minimumWord priorityWord feeWord oracle

#print axioms sharedInvocation
#print axioms atWrapperQuoteReturn
end Inv48.WrapperFundedReturn
