import Inv48PublicObservedQuoteCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PublicObservedQuote
open Inv48.RequestGuards Inv48.ObservedQuoteJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Normal completion comes from the actual public continuation and the
structural no-return certificate, before any responder replay. -/
theorem normalAtCut {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (cut : Inv48.QuoteContinuationIdentity.Cut q n p a b)
    (joined : Inv48.ObservedQuoteJoin.Site.Joined q n p a b fn)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (cut.next (.reverted mid err)) rest (.ok out)) :
    ∃ post bt aft, trace = q.before ++ bt ++ aft ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
        (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body) bt (.ok (.normal post)) ∧
      Interaction.Executes ((internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals (.normal post) >>=
        captureNext [Inv48.QuoteTransport.ret]) >>= q.continuation) aft (.ok out) := by
  obtain ⟨_,_,_,_,actual,bt,aft,split,body,after⟩ := joined.1
  rcases Inv48.QuoteFundingFields.bodyOut n {q.context with checked := true}
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn linked bt actual body with
    ⟨post,rfl⟩ | ⟨mid,err,rfl⟩
  · exact ⟨post,bt,aft,split,body,after⟩
  · simp only [internalCallFinish] at after
    rw [cut.continuation] at after
    exact False.elim (reject _ _ aft after)

#print axioms normalAtCut
end Inv48.PublicObservedQuote
namespace Inv48.PublicObservedQuote
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.ObservedQuoteJoin Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
/-- Deployment facts are required only at a retained successful cut, including
its actual continuation. This condition assumes no such cut exists. -/
def DeploymentAtCut {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) : Prop :=
  ∀ post bt aft, trace = q.before ++ bt ++ aft →
    Interaction.Executes (Stmt.eval (n+55) Inv48.Source.model.core.table {q.context with checked := true}
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body) bt (.ok (.normal post)) →
    Interaction.Executes ((internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals (.normal post) >>=
      captureNext [Inv48.QuoteTransport.ret]) >>= q.continuation) aft (.ok out) →
    ∀ w : Inv48.WholeQuoteEvents.Witness n {q.context with checked := true}
      (Inv48.RequestPrologue.base q.runtime) p a b bt post,
      Nonempty (Inv48.WholeQuoteEvents.Environment w)

theorem foldFromEnvironment {α : Type} {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (cut : Inv48.QuoteContinuationIdentity.Cut q (n+55) p a b)
    (joined : Inv48.ObservedQuoteJoin.Site.Joined q (n+55) p a b fn)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (cut.next (.reverted mid err)) rest (.ok out))
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (ec : Context) (state : State) (data : List Byte)
    (fuel childBudget parentBudget : Nat) (childRows parentRows : ScriptedResponder)
    (raw : SolI α) (observed : Inv48.NestedResponder.Observation raw)
    (computed : Inv48.ObservedEscrowResponder.observe parentBudget
      (Inv48.ObservedEscrowResponder.policy ec state data fuel childBudget childRows parentRows) raw = some observed)
    (outerBefore outerAfter : Interaction.Transcript)
    (outerSplit : observed.trace = outerBefore ++ trace ++ outerAfter)
    (deployment : DeploymentAtCut q n p a b fn) : Folded q (n+55) p a b fn parentRows := by
  obtain ⟨post,bt,aft,split,body,after⟩ := normalAtCut q (n+55) p a b fn linked cut joined reject
  have shape := Inv48.WholeQuote.actualBody
  rw [linked] at shape
  have bodyEq : fn.body = Inv48.WholeQuote.bodyP.value := Option.some.inj shape
  have bodyRun := body
  rw [bodyEq] at bodyRun
  have allSplit : observed.trace = (outerBefore++q.before) ++ bt ++ (aft++outerAfter) := by
    exact outerSplit.trans ((congrArg (fun t => outerBefore ++ t ++ outerAfter) split).trans
      (by simp only [List.append_assoc]))
  obtain ⟨w,fold⟩ := Inv48.WholeQuoteEvents.observedWhole ec state data fuel childBudget parentBudget
    childRows parentRows raw observed computed (outerBefore++q.before) bt (aft++outerAfter) allSplit
    n {q.context with checked := true} (Inv48.RequestPrologue.base q.runtime) p a b hp ha hb post bodyRun
  obtain ⟨e⟩ := deployment post bt aft split body after w
  exact ⟨post,bt,aft,split,(fold e).1,body,by rw [bodyEq]; exact (fold e).2,after⟩
end Inv48.PublicObservedQuote
