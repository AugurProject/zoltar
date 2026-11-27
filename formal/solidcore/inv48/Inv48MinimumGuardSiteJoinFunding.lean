import Inv48MinimumGuardSiteJoinRecovery
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumGuardSiteJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

structure FundingTrace {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder) where
  post : Runtime
  quoteTrace : Interaction.Transcript
  tail : Interaction.Transcript
  split : trace = q.before ++ quoteTrace ++ tail
  recovery : Recovery (n+40) {q.context with checked := true}
    (Inv48.RequestPrologue.base q.runtime) p a b quoteTrace
  aligned : Inv48.ChildExtraction.Matches rows quoteTrace
  quoteRun : (Stmt.eval (n+55) Inv48.Source.model.core.table {q.context with checked := true}
    (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b)
    Inv48.WholeQuote.bodyP.value).runWith rows = .ok (.normal post)
  continuation : Interaction.Executes
    ((internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals (.normal post) >>=
      Inv48.RequestGuards.captureNext [Inv48.QuoteTransport.ret]) >>= q.continuation) tail (.ok out)

theorem fromFolded {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (folded : Inv48.PublicObservedQuote.Folded q (n+55) p a b fn rows) :
    Nonempty (FundingTrace q n p a b fn rows) := by
  obtain ⟨post,bt,aft,split,aligned,body,run,cont⟩ := folded
  have shape := Inv48.WholeQuote.actualBody
  rw [linked] at shape
  have eq : fn.body = Inv48.WholeQuote.bodyP.value := Option.some.inj shape
  rw [eq] at body run
  obtain ⟨s⟩ := fromQuote (n+40) _ _ post p a b hp ha hb bt body
  exact ⟨⟨post,bt,aft,split,s,aligned,run,cont⟩⟩

theorem atFundingCut {α : Type} {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (cut : Inv48.QuoteContinuationIdentity.Cut q (n+55) p a b)
    (joined : Inv48.ObservedQuoteJoin.Site.Joined q (n+55) p a b fn)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (cut.next (.reverted mid err)) rest (.ok out))
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (ec : Context) (state : State) (data : List Source.Byte)
    (fuel childBudget parentBudget : Nat) (childRows parentRows : ScriptedResponder)
    (raw : SolI α) (observed : Inv48.NestedResponder.Observation raw)
    (computed : Inv48.ObservedEscrowResponder.observe parentBudget
      (Inv48.ObservedEscrowResponder.policy ec state data fuel childBudget childRows parentRows) raw = some observed)
    (outerBefore outerAfter : Interaction.Transcript)
    (outerSplit : observed.trace = outerBefore ++ trace ++ outerAfter)
    (deployment : Inv48.PublicObservedQuote.DeploymentAtCut q n p a b fn) : Nonempty (FundingTrace q n p a b fn parentRows) := by
  exact fromFolded q n p a b fn parentRows linked hp ha hb
    (Inv48.PublicObservedQuote.foldFromEnvironment q n p a b fn linked cut joined reject hp ha hb
      ec state data fuel childBudget parentBudget childRows parentRows raw observed computed
      outerBefore outerAfter outerSplit deployment)

#print axioms fromFolded
#print axioms atFundingCut
end Inv48.MinimumGuardSiteJoin
