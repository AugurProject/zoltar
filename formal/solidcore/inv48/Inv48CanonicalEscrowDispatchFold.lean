import Inv48CanonicalEscrowDispatchCut
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.ObservedQuoteJoin
namespace Inv48.CanonicalEscrowDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem foldFromEnvironment {α : Type} {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (cut : Inv48.QuoteContinuationIdentity.Cut q (n+55) p a b)
    (joined : Inv48.ObservedQuoteJoin.Site.Joined q (n+55) p a b fn)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (cut.next (.reverted mid err)) rest (.ok out))
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (schedule : Schedule) (parentBudget : Nat)
    (raw : SolI α) (observed : Inv48.NestedResponder.Observation raw)
    (computed : Inv48.ObservedEscrowResponder.observe parentBudget
      (policy schedule) raw = some observed)
    (outerBefore outerAfter : Interaction.Transcript)
    (outerSplit : observed.trace = outerBefore ++ trace ++ outerAfter)
    (deployment : Inv48.PublicObservedQuote.DeploymentAtCut q n p a b fn) : Inv48.PublicObservedQuote.Folded q (n+55) p a b fn schedule.parentRows := by
  obtain ⟨post,bt,aft,split,body,after⟩ := Inv48.PublicObservedQuote.normalAtCut q (n+55) p a b fn linked cut joined reject
  have shape := Inv48.WholeQuote.actualBody
  rw [linked] at shape
  have bodyEq : fn.body = Inv48.WholeQuote.bodyP.value := Option.some.inj shape
  have bodyRun := body
  rw [bodyEq] at bodyRun
  have allSplit : observed.trace = (outerBefore++q.before) ++ bt ++ (aft++outerAfter) := by
    exact outerSplit.trans ((congrArg (fun t => outerBefore ++ t ++ outerAfter) split).trans
      (by simp only [List.append_assoc]))
  obtain ⟨w⟩ := Inv48.WholeQuoteEvents.witness n {q.context with checked := true}
    (Inv48.RequestPrologue.base q.runtime) p a b hp ha hb bt post bodyRun
  obtain ⟨e⟩ := deployment post bt aft split body after w
  have matched := quoteMatches schedule parentBudget raw observed computed
    (outerBefore++q.before) bt (aft++outerAfter) allSplit w e
  exact ⟨post,bt,aft,split,matched,body,by
    rw [bodyEq]
    exact Inv48.ChildExtraction.foldTrace schedule.parentRows _ bt (Result.normal post) matched bodyRun,after⟩
end Inv48.CanonicalEscrowDispatch
