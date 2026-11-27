import Inv48ObservedMinimumGuardStage
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumGuard
open Inv48.Positive Inv48.QuoteMinimumJoin Inv48.WholeQuote Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The body and its deployments/oracles remain indexed by the actual
observed snapshots. Folding uses the same body transcript, not a fresh
successful getter or a reconstructed QuoteMinimumJoin.Inputs record. -/
theorem observedQuoteStage (n : Nat) (c : Context) (physical after : Runtime)
    (rows : ScriptedResponder) (p a bounty : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : bounty<Inv32Division.R)
    (trace : Interaction.Transcript) (out : Result)
    (s : Inv48.FundingMinimumObserved.Body n {c with checked := true}
      {callSite (prepared physical p a bounty).pushScope p with locals := []} p trace out)
    (bodyRun : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table
      {c with checked := true}
      (start {callSite (prepared physical p a bounty).pushScope p with locals := []} p)
      Inv48.Public.body) trace (.ok out))
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (dC : Inv48.CollateralCloneStage.Deployment s.collateral.joined.context s.collateral.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.collateral.joined)
    (envC : CanonicalOracle s.collateral.joined.context s.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.rep.joined.context s.rep.joined.caller)
    (envR : CanonicalOracle s.rep.joined.context s.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.rep.joined.during)
    (quoteRun : (Stmt.eval ((n+5)+6) Inv48.Source.model.core.table c
      (entry physical p a bounty) bodyP.value).runWith rows = .ok (.normal after)) :
    ∃ cr x C rr y R final,
      OracleEvent s.collateral.joined.context s.collateral.joined.start dC.root
        (Inv48.CollateralCloneStage.bytes dC) s.collateral.joined.during cr ∧
      cr.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded cr x ∧
      C = b.base + Inv03.ceilQuot x 100 ∧ C < Inv32Division.R ∧
      OracleEvent s.rep.joined.context s.rep.joined.start dR.root
        (Inv48.RepReturnedMinimum.bytes dR) s.rep.joined.during rr ∧
      rr.success = true ∧ y < Inv32Division.R ∧ Inv48.ExposureComparison.decoded rr y ∧
      R = Inv03.ceilQuot y 100 ∧ R < Inv32Division.R ∧
      out = .returned final [.word (max C (Inv03.ceilQuot (R*10^18) p))] ∧
      C≤a ∧ R*10^18≤a*p ∧
      (Stmt.eval ((n+5)+4) Inv48.Source.model.core.table c (prepared physical p a bounty)
        minP.value).runWith rows =
        .ok (.normal (afterBase (prepared physical p a bounty) final)) ∧
      (afterBase (prepared physical p a bounty) final).locals = (prepared physical p a bounty).locals ∧
      (afterBase (prepared physical p a bounty) final).state = final.state := by
  obtain ⟨cr,x,C,rr,y,R,final,ce,cs,xf,xd,cf,Cf,re,rs,yf,yd,rf,Rf,qf,_,value,least⟩ :=
    Inv48.FundingMinimumObserved.bodyCertificate s hp dC b envC dR envR
  have folded := Inv48.ChildExtraction.foldTrace rows _ trace out aligned bodyRun
  rw [value] at folded
  have mf : max C (Inv03.ceilQuot (R*10^18) p) < Inv32Division.R := max_lt Cf qf
  obtain ⟨suff,stage,_,_,_⟩ := quoteStage (n+5) c physical final after rows p a bounty _ hp ha hb mf folded quoteRun
  have enough := (least a).mp suff
  exact ⟨cr,x,C,rr,y,R,final,ce,cs,xf,xd,cf,Cf,re,rs,yf,yd,rf,Rf,value,enough.1,enough.2,stage,rfl,rfl⟩

#print axioms observedQuoteStage
end Inv48.ObservedMinimumGuard
