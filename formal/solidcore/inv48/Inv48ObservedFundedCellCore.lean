import Inv48ObservedMinimumHeapCut
import Inv48ObservedSuffixBoundsCut
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedFundedCell
open Inv48.WholeQuote Inv48.QuoteMemory Inv48.ObservedMinimumHeap
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def funded (actual : Runtime) (id a p : Nat) : Runtime :=
  put (Inv32OneArg.store (put actual id a 0 0 0 0)
    Inv32CeilFlags.h0 (Inv48.QuoteExec.repAmount a p))
    id a (Inv48.QuoteExec.repAmount a p) 0 0 0

theorem fundingFacts (getter actual : Runtime) (a rep id : Nat)
    (state : actual.state = getter.state)
    (ref : actual.lookupLocal? "quote" = some (.memoryRef id))
    (next : actual.nextMemory = id+3) :
    (put (Inv32OneArg.store (put actual id a 0 0 0 0) Inv32CeilFlags.h0 rep) id a rep 0 0 0).state = getter.state ∧
    (put (Inv32OneArg.store (put actual id a 0 0 0 0) Inv32CeilFlags.h0 rep) id a rep 0 0 0).lookupLocal? "quote" = some (.memoryRef id) ∧
    (put (Inv32OneArg.store (put actual id a 0 0 0 0) Inv32CeilFlags.h0 rep) id a rep 0 0 0).loadMemory? id = some (tuple a rep 0 0 0) ∧
    (put (Inv32OneArg.store (put actual id a 0 0 0 0) Inv32CeilFlags.h0 rep) id a rep 0 0 0).nextMemory = id+3 := by
  have localRef := (store_other (put actual id a 0 0 0 0)
    rep "quote" (by decide)).trans ref
  have cell := put_load (Inv32OneArg.store (put actual id a 0 0 0 0)
    Inv32CeilFlags.h0 rep) id a rep 0 0 0
  exact ⟨state,localRef,cell,next⟩

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
      (Inv48.RepReturnedMinimum.bytes dR) h.observed.rep.joined.during)
    (run : Interaction.Executes (Stmt.eval (n+55) Inv48.Source.model.core.table
      {q.context with checked := true} (entry (Inv48.RequestPrologue.base q.runtime) p a b)
      bodyP.value) s.quoteTrace (.ok (.normal s.post))) :
    let id := (Inv48.RequestPrologue.base q.runtime).nextMemory
    let f := funded s.recovery.cut.minimumFinal id a p
    ∃ C R getter words last mt st,
      C≤a ∧ R*10^18≤a*p ∧ Inv48.QuoteExec.repAmount a p<Inv32Division.R ∧
      s.recovery.value = .returned getter words ∧
      f.state = getter.state ∧
      f.lookupLocal? "quote" = some (.memoryRef id) ∧
      f.loadMemory? id = some (tuple a (Inv48.QuoteExec.repAmount a p) 0 0 0) ∧
      f.nextMemory = id+3 ∧
      s.quoteTrace = mt ++ st ∧
      Interaction.Executes (Stmt.evalList (n+53) Inv48.Source.model.core.table
        {q.context with checked := true} f tailCode) st (.ok (.normal last)) ∧
      last.popScope.popScope = s.post := by
  obtain ⟨C,R,getter,words,ca,ra,value,same,ref,mem,next⟩ :=
    Inv48.ObservedMinimumHeap.atFundingCut q n p a b fn rows s h hp ha hb dC base envC dR envR
  have A : s.recovery.cut.minimumFinal.lookupLocal? "requestedInitialAttoWeth" = some (.word a) := by
    rw [← same]; rfl
  have P : s.recovery.cut.minimumFinal.lookupLocal? "proposedRepPerEthPrice" = some (.word p) := by
    rw [← same]; rfl
  obtain ⟨fit,last,mt,st,split,tail,pop⟩ := Inv48.ObservedSuffixBounds.atFundingCut
    q n p a b fn rows s hp ha hb _ 0 0 0 0 0 ref mem A P run
  have state : s.recovery.cut.minimumFinal.state = getter.state := by
    rw [← same]
    rfl
  have facts := fundingFacts getter s.recovery.cut.minimumFinal a (Inv48.QuoteExec.repAmount a p) _ state ref next
  exact ⟨C,R,getter,words,last,mt,st,ca,ra,fit,value,facts.1,facts.2.1,
    facts.2.2.1,facts.2.2.2,split,tail,pop⟩

#print axioms atFundingCut
end Inv48.ObservedFundedCell
