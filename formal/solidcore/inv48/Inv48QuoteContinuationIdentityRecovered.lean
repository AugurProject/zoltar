import Inv48QuoteContinuationIdentityInvocation
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
namespace Inv48.QuoteContinuationIdentity
open Inv48.ActualSiteGuardJoin Inv48.SiteEntryBridge
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem recovered {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (n : Nat) (targets : List String) (expressions : List Expr)
    (found : Inv48.WrapperTraversal.Recovered root targets expressions trace out (n+6))
    (fn quoteFn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn) :
    ∃ callSite : Site root Inv48.Source.model.core.table
        (.internalCall targets Inv48.RequestQuote.requestKey expressions) trace out,
      ∃ values mid argumentTrace,
        Interaction.Executes (Expr.evalRefArgList callSite.context callSite.runtime expressions).caught
          argumentTrace (.ok (.ok (values,mid))) ∧
        ∀ s p a b g, values = args s p a b g →
          p < 2^256 → a < 2^256 → b < 2^256 → g < 2^32 →
          ∃ q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
            Inv48.ObservedQuoteJoin.Site.Joined q n p a b quoteFn ∧ Nonempty (Cut q n p a b) := by
  obtain ⟨callSite,fuel,final,during,rest,split,first,last⟩ := found
  obtain ⟨values,mid,argumentTrace,remaining,_,arguments,join⟩ :=
    invocation n callSite.context callSite.runtime final targets expressions during fn quoteFn registered linked first
  refine ⟨callSite,values,mid,argumentTrace,arguments,?_⟩
  intro s p a b g eq hp ha hb hg
  obtain ⟨localSite,joined,⟨cut⟩⟩ := join s p a b g eq hp ha hb hg
  let q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out :=
    {localSite with
      continuation := fun v => localSite.continuation v >>= callSite.continuation
      before := callSite.before ++ localSite.before
      after := localSite.after ++ rest
      split := by
        calc
          trace = callSite.before ++ callSite.after := callSite.split
          _ = callSite.before ++ (during ++ rest) := congrArg (fun tr => callSite.before ++ tr) split
          _ = callSite.before ++ ((localSite.before ++ localSite.after) ++ rest) :=
            congrArg (fun tr => callSite.before ++ (tr ++ rest)) localSite.split
          _ = _ := by simp only [List.append_assoc]
      reached := callSite.reached.trans (by
        have h := localSite.reached.bind callSite.continuation
        simpa only [fuel,assoc] using h)
      suffix := by
        have h := Interaction.Executes.bind_ok localSite.suffix last
        change Interaction.Executes ((Stmt.eval localSite.fuel Inv48.Source.model.core.table
          localSite.context localSite.runtime Inv48.RequestQuote.quoteCaptureP.value >>=
          localSite.continuation) >>= callSite.continuation) (localSite.after ++ rest) (.ok out) at h
        simpa only [assoc] using h}
  obtain ⟨⟨qfuel,P,A,B,_⟩,origin,originEq⟩ := joined
  refine ⟨q,⟨⟨qfuel,P,A,B,Inv48.SiteEntryBridge.concreteEntry q n p a b quoteFn linked hp ha hb qfuel P A B⟩,origin,originEq⟩,?_⟩
  refine ⟨{ cut with
    next := fun v => cut.next v >>= callSite.continuation
    before := callSite.before ++ cut.before
    after := cut.after ++ rest
    quoteBefore := congrArg (fun tr => callSite.before ++ tr) cut.quoteBefore
    quoteAfter := congrArg (fun tr => tr ++ rest) cut.quoteAfter
    split := ?_
    reached := ?_
    execution := ?_
    continuation := ?_ }⟩
  · simpa only [List.append_assoc] using callSite.split.trans
      ((congrArg (fun tr => callSite.before ++ tr) split).trans
        (congrArg (fun tr => callSite.before ++ (tr ++ rest)) cut.split))
  · apply callSite.reached.trans
    have h := cut.reached.bind callSite.continuation
    simpa only [q,fuel,assoc] using h
  · have h := Interaction.Executes.bind_ok cut.execution last
    change Interaction.Executes ((Stmt.evalList (n+3) Inv48.Source.model.core.table localSite.context cut.start (Inv48.RequestQuote.actual.drop 6) >>= cut.next) >>= callSite.continuation) (cut.after ++ rest) (.ok out) at h
    simpa only [q,assoc] using h
  · change (fun v => localSite.continuation v >>= callSite.continuation) = _
    rw [cut.continuation]
    simp only [q,assoc]


end Inv48.QuoteContinuationIdentity
