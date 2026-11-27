import Inv48ObservedMinimumHeapWrites
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.Positive Inv48.QuoteMinimumJoin Inv48.WholeQuote Inv48.QuoteMemory Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem atMinimumFinal (n : Nat) (c : Context) (physical after : Runtime)
    (rows : ScriptedResponder) (p a bounty : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : bounty<Inv32Division.R)
    (trace : Interaction.Transcript) (out : Result)
    (s : Body n {c with checked := true}
      {callSite (prepared physical p a bounty).pushScope p with locals := []} p trace out)
    (bodyRun : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table
      {c with checked := true}
      (start {callSite (prepared physical p a bounty).pushScope p with locals := []} p)
      Inv48.Public.body) trace (.ok out))
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (dC : Inv48.CollateralCloneStage.Deployment s.observed.collateral.joined.context s.observed.collateral.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.observed.collateral.joined)
    (envC : CanonicalOracle s.observed.collateral.joined.context s.observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.observed.rep.joined.context s.observed.rep.joined.caller)
    (envR : CanonicalOracle s.observed.rep.joined.context s.observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.observed.rep.joined.during)
    (quoteRun : (Stmt.eval ((n+5)+6) Inv48.Source.model.core.table c
      (entry physical p a bounty) bodyP.value).runWith rows = .ok (.normal after))
    (actual : Runtime) (minimumTrace : Interaction.Transcript)
    (minimumAligned : Inv48.ChildExtraction.Matches rows minimumTrace)
    (minimumRun : Interaction.Executes (Stmt.eval ((n+5)+4) Inv48.Source.model.core.table c
      (prepared physical p a bounty) minP.value) minimumTrace (.ok (.normal actual))) :
    ∃ C R getter words,
      C≤a ∧ R*10^18≤a*p ∧ out = .returned getter words ∧
      Inv48.ObservedMinimumGuard.afterBase (prepared physical p a bounty) getter = actual ∧
      actual.lookupLocal? "quote" = some (.memoryRef physical.nextMemory) ∧
      actual.loadMemory? physical.nextMemory = some (tuple 0 0 0 0 0) ∧
      actual.nextMemory = physical.nextMemory+3 := by
  obtain ⟨cr,x,C,rr,y,R,getter,ce,cs,xf,xd,cf,Cf,re,rs,yf,yd,rf,Rf,value,ca,ra,stage,_,_⟩ :=
    Inv48.ObservedMinimumGuard.observedQuoteStage n c physical after rows p a bounty hp ha hb
      trace out s.observed bodyRun aligned dC b envC dR envR quoteRun
  have folded := Inv48.ChildExtraction.foldTrace rows _ _ _ minimumAligned minimumRun
  have same := Result.normal.inj (Except.ok.inj (stage.symm.trans folded))
  obtain ⟨ref,mem,next⟩ := quoteCell physical p a bounty s hp dC b envC dR envR getter _ value
  rw [same] at ref mem next
  exact ⟨C,R,getter,_,ca,ra,value,same,ref,mem,next⟩
end Inv48.ObservedMinimumHeap
