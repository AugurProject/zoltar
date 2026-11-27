import Inv48ObservedMinimumHeapFunding
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.WholeQuote Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem recoverAtFundingCut {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (s : Inv48.MinimumGuardSiteJoin.FundingTrace q n p a b fn rows) :
    Nonempty (Body (n+44) {{q.context with checked := true} with checked := true}
      {Inv48.QuoteMinimumJoin.callSite
        (prepared (Inv48.RequestPrologue.base q.runtime) p a b).pushScope p with locals := []}
      p s.recovery.during s.recovery.value) := by
  exact recover s.recovery.body s.recovery.bodyRun

theorem atFundingCut {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (s : Inv48.MinimumGuardSiteJoin.FundingTrace q n p a b fn rows)
    (h : Body (n+44) {{q.context with checked := true} with checked := true}
      {Inv48.QuoteMinimumJoin.callSite
        (prepared (Inv48.RequestPrologue.base q.runtime) p a b).pushScope p with locals := []}
      p s.recovery.during s.recovery.value)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (dC : Inv48.CollateralCloneStage.Deployment h.observed.collateral.joined.context h.observed.collateral.joined.caller)
    (base : Inv48.CollateralReturnedMinimum.BaseDeployment h.observed.collateral.joined)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle h.observed.collateral.joined.context h.observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) h.observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment h.observed.rep.joined.context h.observed.rep.joined.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle h.observed.rep.joined.context h.observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) h.observed.rep.joined.during) :
    ∃ C R getter words,
      C≤a ∧ R*10^18≤a*p ∧ s.recovery.value = .returned getter words ∧
      Inv48.ObservedMinimumGuard.afterBase (prepared (Inv48.RequestPrologue.base q.runtime) p a b) getter =
        s.recovery.cut.minimumFinal ∧
      s.recovery.cut.minimumFinal.lookupLocal? "quote" =
        some (.memoryRef (Inv48.RequestPrologue.base q.runtime).nextMemory) ∧
      s.recovery.cut.minimumFinal.loadMemory? (Inv48.RequestPrologue.base q.runtime).nextMemory =
        some (tuple 0 0 0 0 0) ∧
      s.recovery.cut.minimumFinal.nextMemory = (Inv48.RequestPrologue.base q.runtime).nextMemory+3 := by
  have aligned : Inv48.ChildExtraction.Matches rows s.recovery.cut.minimumTrace := by
    intro event member
    apply s.aligned event
    rw [s.recovery.cut.quoteSplit]
    exact List.mem_append_left _ member
  exact atMinimumFinal (n+44) {q.context with checked := true}
    (Inv48.RequestPrologue.base q.runtime) s.post rows p a b hp ha hb
    s.recovery.during s.recovery.value h s.recovery.bodyRun
    (Inv48.MinimumGuardSiteJoin.bodyMatches s.recovery rows s.aligned)
    dC base envC dR envR s.quoteRun s.recovery.cut.minimumFinal
    s.recovery.cut.minimumTrace aligned s.recovery.cut.minimumRun
end Inv48.ObservedMinimumHeap
