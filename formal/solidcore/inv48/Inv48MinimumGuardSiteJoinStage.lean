import Inv48MinimumGuardSiteJoinFunding
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumGuardSiteJoin
open Inv48.Positive Inv48.QuoteMinimumJoin Inv48.WholeQuote Inv48.MinimumSuccessWords
open Inv48.ObservedMinimumGuard
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Apply the guard to the recovered body and export its adopted runtime on
this funding trace, retaining the actual fee/escrow continuation. -/
theorem fundingStage {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (s : FundingTrace q n p a b fn rows)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (dC : Inv48.CollateralCloneStage.Deployment s.recovery.body.collateral.joined.context s.recovery.body.collateral.joined.caller)
    (b_ : Inv48.CollateralReturnedMinimum.BaseDeployment s.recovery.body.collateral.joined)
    (envC : CanonicalOracle s.recovery.body.collateral.joined.context s.recovery.body.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.recovery.body.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.recovery.body.rep.joined.context s.recovery.body.rep.joined.caller)
    (envR : CanonicalOracle s.recovery.body.rep.joined.context s.recovery.body.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.recovery.body.rep.joined.during)
 :
    ∃ cr x C rr y R final,
      OracleEvent s.recovery.body.collateral.joined.context s.recovery.body.collateral.joined.start dC.root
        (Inv48.CollateralCloneStage.bytes dC) s.recovery.body.collateral.joined.during cr ∧
      cr.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded cr x ∧
      C = b_.base + Inv03.ceilQuot x 100 ∧ C < Inv32Division.R ∧
      OracleEvent s.recovery.body.rep.joined.context s.recovery.body.rep.joined.start dR.root
        (Inv48.RepReturnedMinimum.bytes dR) s.recovery.body.rep.joined.during rr ∧
      rr.success = true ∧ y < Inv32Division.R ∧ Inv48.ExposureComparison.decoded rr y ∧
      R = Inv03.ceilQuot y 100 ∧ R < Inv32Division.R ∧
      s.recovery.value = .returned final [.word (max C (Inv03.ceilQuot (R*10^18) p))] ∧
      C≤a ∧ R*10^18≤a*p ∧
      (Stmt.eval ((n+49)+4) Inv48.Source.model.core.table {q.context with checked := true} (prepared (Inv48.RequestPrologue.base q.runtime) p a b)
        minP.value).runWith rows =
        .ok (.normal (afterBase (prepared (Inv48.RequestPrologue.base q.runtime) p a b) final)) ∧
      (afterBase (prepared (Inv48.RequestPrologue.base q.runtime) p a b) final).locals = (prepared (Inv48.RequestPrologue.base q.runtime) p a b).locals ∧
      (afterBase (prepared (Inv48.RequestPrologue.base q.runtime) p a b) final).state = final.state ∧
      afterBase (prepared (Inv48.RequestPrologue.base q.runtime) p a b) final = s.recovery.cut.minimumFinal ∧
      ∀ tail : List Source.Stmt,
        (Stmt.evalList (n+53) Inv48.Source.model.core.table {q.context with checked := true}
          (prepared (Inv48.RequestPrologue.base q.runtime) p a b) (minP.value :: tail)).runWith rows =
        (Stmt.evalList (n+53) Inv48.Source.model.core.table {q.context with checked := true}
          (afterBase (prepared (Inv48.RequestPrologue.base q.runtime) p a b) final) tail).runWith rows := by
  obtain ⟨cr,x,C,rr,y,R,final,ce,cs,xf,xd,cf,Cf,re,rs,yf,yd,rf,Rf,value,ca,ra,stage,locals,state⟩ := observedQuoteStage (n+44) {q.context with checked := true}
    (Inv48.RequestPrologue.base q.runtime) s.post rows p a b hp ha hb
    s.recovery.during s.recovery.value s.recovery.body s.recovery.bodyRun
    (bodyMatches s.recovery rows s.aligned) dC b_ envC dR envR s.quoteRun
  have aligned : Inv48.ChildExtraction.Matches rows s.recovery.cut.minimumTrace := by
    intro event member
    apply s.aligned event
    rw [s.recovery.cut.quoteSplit]
    exact List.mem_append_left _ member
  have actual := Inv48.ChildExtraction.foldTrace rows _ _ _ aligned s.recovery.cut.minimumRun
  have same : afterBase (prepared (Inv48.RequestPrologue.base q.runtime) p a b) final =
      s.recovery.cut.minimumFinal := by
    exact Result.normal.inj (Except.ok.inj (stage.symm.trans actual))
  refine ⟨cr,x,C,rr,y,R,final,ce,cs,xf,xd,cf,Cf,re,rs,yf,yd,rf,Rf,value,ca,ra,stage,locals,state,same,?_⟩
  intro tail
  exact continueAfterMinimum (n+52) {q.context with checked := true}
    (prepared (Inv48.RequestPrologue.base q.runtime) p a b) final rows tail stage

#print axioms fundingStage
end Inv48.MinimumGuardSiteJoin
