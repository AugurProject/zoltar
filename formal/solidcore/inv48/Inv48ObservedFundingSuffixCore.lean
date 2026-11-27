import Inv48FundingContinuationSite
import Inv48MinimumGuardSiteJoinStage
import Inv48QuoteFundingFieldsFunding
import Inv48RequestQuoteEval
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedFundingSuffix
open Inv48.WholeQuote Inv48.QuoteMemory Inv48.WrapperTraversal Inv48.MinimumCollateralTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Invert the successful quote itself and retain its actual post-minimum suffix. -/
theorem retained (n : Nat) (c : Context) (physical post : Runtime) (p a b : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (entry physical p a b) bodyP.value) trace (.ok (.normal post))) :
    ∃ minimumFinal last minimumTrace suffixTrace,
      trace = minimumTrace ++ suffixTrace ∧
      Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c
        (prepared physical p a b) minP.value) minimumTrace (.ok (.normal minimumFinal)) ∧
      Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c minimumFinal
        (collateralWrite :: fundingCode ++ tailCode)) suffixTrace (.ok (.normal last)) ∧
      last.popScope.popScope = post := by
  rw [bodyForm] at run
  obtain ⟨k,v,eq,outEq,outer⟩ := block _ _ _ _ _ _ _ run
  have ke : k=n+4 := by omega
  subst k
  cases v <;> simp only [Result.mapRuntime,Result.normal.injEq] at outEq <;> try contradiction
  case normal outerLast =>
    rw [listAppend,prologueExecution (n+3) _ c physical p a b hp ha hb] at outer
    change Interaction.Executes (Stmt.evalList (n+4) _ c (allocated physical p a b).pushScope
      [.block (minP.value :: collateralWrite :: fundingCode ++ tailCode)]) trace (.ok (.normal outerLast)) at outer
    have inside := singleton _ _ _ _ _ _ _ outer
    obtain ⟨j,w,eq2,valueEq,interior⟩ := block _ _ _ _ _ _ _ inside
    have je : j=n+3 := by omega
    subst j
    cases w <;> simp only [Result.mapRuntime,Result.normal.injEq] at valueEq <;> try contradiction
    case normal last =>
      obtain ⟨mid,mt,st,split,minimum,suffix⟩ := Inv48.QuoteTransport.normalCons
        (n+3) Inv48.Source.model.core.table c (prepared physical p a b) last
        minP.value (collateralWrite :: fundingCode ++ tailCode) trace interior
      exact ⟨mid,last,mt,st,split,minimum,suffix,by rw [outEq,valueEq]⟩

#print axioms retained
end Inv48.ObservedFundingSuffix

namespace Inv48.ObservedFundingSuffix
open Inv48.WholeQuote Inv48.QuoteMemory
/-- Identify the inverted minimum with the cut used by fundingStage, retaining
its actual suffix. Both executions use the original responder rows. -/
theorem atFundingCut {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (s : Inv48.MinimumGuardSiteJoin.FundingTrace q n p a b fn rows)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (run : Interaction.Executes (Stmt.eval (n+55) Inv48.Source.model.core.table
      {q.context with checked := true} (entry (Inv48.RequestPrologue.base q.runtime) p a b)
      bodyP.value) s.quoteTrace (.ok (.normal s.post))) :
    ∃ last mt st, s.quoteTrace = mt ++ st ∧
      Interaction.Executes (Stmt.evalList (n+53) Inv48.Source.model.core.table
        {q.context with checked := true} s.recovery.cut.minimumFinal
        (collateralWrite :: fundingCode ++ tailCode)) st (.ok (.normal last)) ∧
      last.popScope.popScope = s.post := by
  obtain ⟨mid,last,mt,st,split,minimum,suffix,pop⟩ := retained (n+50)
    {q.context with checked := true} (Inv48.RequestPrologue.base q.runtime) s.post p a b hp ha hb s.quoteTrace run
  have am : Inv48.ChildExtraction.Matches rows mt := by
    intro event member
    apply s.aligned event
    rw [split]
    exact List.mem_append_left _ member
  have bm : Inv48.ChildExtraction.Matches rows s.recovery.cut.minimumTrace := by
    intro event member
    apply s.aligned event
    rw [s.recovery.cut.quoteSplit]
    exact List.mem_append_left _ member
  have left := Inv48.ChildExtraction.foldTrace rows _ _ _ am minimum
  have right := Inv48.ChildExtraction.foldTrace rows _ _ _ bm s.recovery.cut.minimumRun
  have same : mid = s.recovery.cut.minimumFinal := Result.normal.inj (Except.ok.inj (left.symm.trans right))
  rw [same] at suffix
  exact ⟨last,mt,st,split,suffix,pop⟩
#print axioms atFundingCut
end Inv48.ObservedFundingSuffix
