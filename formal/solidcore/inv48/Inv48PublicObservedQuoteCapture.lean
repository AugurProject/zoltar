import Inv48PublicObservedQuoteCore
import Inv48ObservedQuoteJoinCapture
import Inv48QuoteContinuationIdentityObserved
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
namespace Inv48.PublicObservedQuote.Capture
open Inv48.ActualSiteGuardJoin Inv48.SiteEntryBridge
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
open Inv48.ObservedQuoteJoin
theorem observedCapture {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (cut : Inv48.QuoteContinuationIdentity.Cut q n p a b)
    (joined : Inv48.ObservedQuoteJoin.Site.Joined q n p a b fn)
    (quoteAligned : Inv48.PublicObservedQuote.Folded q n p a b fn rows) (post : Runtime)
    (evaluation : (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body).runWith rows = .ok (.normal post))
    (returns : fn.returns = [⟨"quote",Inv48.WholeQuote.quoteTy,false⟩])
    (id rep : Nat) (keeps : Inv48.QuoteTailPreserve.Keeps post id a rep) :
    ∃ origin caller bodyTrace afterTrace,
      q.runtime = Inv48.SiteEntryBridge.prepared origin p a b ∧
      caller = captured post origin p a b id ∧
      trace = q.before ++ bodyTrace ++ afterTrace ∧
      Inv48.ChildExtraction.Matches rows bodyTrace ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
        (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body)
        bodyTrace (.ok (.normal post)) ∧
      (internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals (.normal post) >>=
        captureNext [Inv48.QuoteTransport.ret]) = pure (.normal caller) ∧
      caller.lookupLocal? Inv48.QuoteTransport.ret = some (.memoryRef id) ∧
      Inv48.QuoteFundingFields.Fields caller id a rep ∧
      Interaction.Executes (q.continuation (.normal caller)) afterTrace (.ok out) ∧
      Interaction.Executes
        (Stmt.eval (n+2) Inv48.Source.model.core.table q.context caller
          Inv48.QuoteTransport.aliasP.value >>= fun v =>
            pop v >>= fun x => listNext (n+3) Inv48.Source.model.core.table q.context
              (Inv48.RequestQuote.actual.drop 7) x >>= cut.next)
        afterTrace (.ok out) := by
  obtain ⟨bt,aft,split,bodyAligned,body,after⟩ :=
    Inv48.PublicObservedQuote.observedBody q n p a b fn rows joined.1 quoteAligned (.normal post) evaluation
  obtain ⟨origin,originEq⟩ := joined.2
  have cap := capturePrepared fn post origin p a b id rep returns keeps
  have finish : (internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals (.normal post) >>=
      captureNext [Inv48.QuoteTransport.ret]) = pure (.normal (captured post origin p a b id)) := by
    rw [originEq]
    exact cap.1
  rw [finish] at after
  refine ⟨origin,captured post origin p a b id,bt,aft,originEq,rfl,split,bodyAligned,
    body,finish,cap.2.1,cap.2.2,after,?_⟩
  rw [cut.continuation] at after
  simpa only [listNext,Inv48.WholeQuote.singleList,assoc] using after

end Inv48.PublicObservedQuote.Capture
