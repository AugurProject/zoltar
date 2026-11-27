import Inv48QuoteFundingFieldsNormal
import Inv48QuoteContinuationIdentityCapture
import Inv48WholeQuoteEventsObserved
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PublicObservedQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Exactly one retained body computation, with its original continuation. -/
def Folded {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder) : Prop :=
  ∃ post bt aft, trace = q.before ++ bt ++ aft ∧
    Inv48.ChildExtraction.Matches rows bt ∧
    Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body) bt (.ok (.normal post)) ∧
    (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body).runWith rows = .ok (.normal post) ∧
    Interaction.Executes ((internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals (.normal post) >>=
      Inv48.RequestGuards.captureNext [Inv48.QuoteTransport.ret]) >>= q.continuation) aft (.ok out)

 theorem observedBody {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (_joined : Inv48.ActualSiteGuardJoin.Joined q n p a b fn)
    (folded : Folded q n p a b fn rows) (computed : Result)
    (evaluation : (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body).runWith rows = .ok computed) :
    ∃ bt aft, trace = q.before ++ bt ++ aft ∧ Inv48.ChildExtraction.Matches rows bt ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
        (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body) bt (.ok computed) ∧
      Interaction.Executes ((internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals computed >>=
        Inv48.RequestGuards.captureNext [Inv48.QuoteTransport.ret]) >>= q.continuation) aft (.ok out) := by
  obtain ⟨post,bt,aft,split,matched,body,run,after⟩ := folded
  have eq : computed = .normal post := Except.ok.inj (evaluation.symm.trans run)
  subst computed
  exact ⟨bt,aft,split,matched,body,after⟩
end Inv48.PublicObservedQuote
