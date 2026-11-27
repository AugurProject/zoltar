import Inv48ObservedQuoteJoinSite
import Inv48QuoteTailPreserveSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedQuoteJoin
open Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def captured (post origin : Runtime) (p a b id : Nat) : Runtime :=
  {post with locals := ((Inv48.QuoteTransport.ret,.memoryRef id) ::
    Inv48.QuoteTransport.argsFrame p a b) :: origin.locals}

theorem capturePrepared (fn : InternalFunction) (post origin : Runtime)
    (p a b id rep : Nat)
    (returns : fn.returns = [⟨"quote",Inv48.WholeQuote.quoteTy,false⟩])
    (keeps : Inv48.QuoteTailPreserve.Keeps post id a rep) :
    let caller := captured post origin p a b id
    (internalCallFinish fn [Inv48.QuoteTransport.ret]
      (Inv48.SiteEntryBridge.prepared origin p a b).locals (.normal post) >>=
      captureNext [Inv48.QuoteTransport.ret]) = pure (.normal caller) ∧
    caller.lookupLocal? Inv48.QuoteTransport.ret = some (.memoryRef id) ∧
    Inv48.QuoteFundingFields.Fields caller id a rep := by
  dsimp only
  refine ⟨?_,?_,Inv48.QuoteFundingFields.sameHeap post _ id a rep keeps.2 rfl⟩
  · rw [Inv48.QuoteMemory.finishQuote fn post _ _ id returns keeps.1]
    rw [Inv48.SiteEntryBridge.preparedLocals]
    have assign : internalCallAssign
        {post with locals := ((Inv48.QuoteTransport.ret,.memoryRef origin.nextMemory) ::
          Inv48.QuoteTransport.argsFrame p a b) :: origin.locals}
        [Inv48.QuoteTransport.ret] [.memoryRef id] = pure (.normal (captured post origin p a b id)) := by
      simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
        Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,LocalEnv.lookup?,
        Frame.lookup?,LocalEnv.assign?,Frame.assign?,captured,Inv48.QuoteTransport.ret]
    rw [assign]
    rfl
  · rfl

/-- This identifies the actual body result and then reduces the actual finish
and capture. All alignment is inherited from the complete trace. -/
theorem observedCapture {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (joined : Site.Joined q n p a b fn)
    (full : Inv48.ChildExtraction.Matches rows trace) (post : Runtime)
    (evaluation : (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body).runWith rows = .ok (.normal post))
    (returns : fn.returns = [⟨"quote",Inv48.WholeQuote.quoteTy,false⟩])
    (id rep : Nat) (keeps : Inv48.QuoteTailPreserve.Keeps post id a rep) :
    ∃ origin caller bodyTrace afterTrace,
      q.runtime = Inv48.SiteEntryBridge.prepared origin p a b ∧
      caller = captured post origin p a b id ∧
      trace = q.before ++ bodyTrace ++ afterTrace ∧
      Inv48.ChildExtraction.Matches rows bodyTrace ∧ Inv48.ChildExtraction.Matches rows afterTrace ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
        (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body)
        bodyTrace (.ok (.normal post)) ∧
      (internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals (.normal post) >>=
        captureNext [Inv48.QuoteTransport.ret]) = pure (.normal caller) ∧
      caller.lookupLocal? Inv48.QuoteTransport.ret = some (.memoryRef id) ∧
      Inv48.QuoteFundingFields.Fields caller id a rep ∧
      Interaction.Executes (q.continuation (.normal caller)) afterTrace (.ok out) := by
  obtain ⟨bt,aft,split,bodyAligned,afterAligned,body,after⟩ :=
    observedBody q n p a b fn rows joined.1 full (.normal post) evaluation
  obtain ⟨origin,originEq⟩ := joined.2
  have cap := capturePrepared fn post origin p a b id rep returns keeps
  have finish : (internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals (.normal post) >>=
      captureNext [Inv48.QuoteTransport.ret]) = pure (.normal (captured post origin p a b id)) := by
    rw [originEq]
    exact cap.1
  rw [finish] at after
  exact ⟨origin,captured post origin p a b id,bt,aft,originEq,rfl,split,bodyAligned,afterAligned,
    body,finish,cap.2.1,cap.2.2,after⟩
end Inv48.ObservedQuoteJoin
