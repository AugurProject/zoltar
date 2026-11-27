import Inv48QuoteContinuationIdentityShared
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
namespace Inv48.QuoteContinuationIdentity
open Inv48.ActualSiteGuardJoin Inv48.SiteEntryBridge
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem invocation (n : Nat) (c : Context) (r final : Runtime)
    (targets : List String) (expressions : List Expr) (trace : Interaction.Transcript)
    (fn quoteFn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn)
    (run : Interaction.Executes (Stmt.eval (n+6) Inv48.Source.model.core.table c r
      (.internalCall targets Inv48.RequestQuote.requestKey expressions)) trace (.ok (.normal final))) :
    ∃ values mid argumentTrace remaining,
      trace = argumentTrace ++ remaining ∧
      Interaction.Executes (Expr.evalRefArgList c r expressions).caught argumentTrace (.ok (.ok (values,mid))) ∧
      ∀ s p a b g, values = args s p a b g →
        p < 2^256 → a < 2^256 → b < 2^256 → g < 2^32 →
        ∃ q : Site (Stmt.eval (n+6) Inv48.Source.model.core.table c r
            (.internalCall targets Inv48.RequestQuote.requestKey expressions))
            Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace (.normal final),
          Inv48.ObservedQuoteJoin.Site.Joined q n p a b quoteFn ∧ Nonempty (Cut q n p a b) := by
  rw [Stmt.eval] at run
  change Interaction.Executes ((Expr.evalRefArgList c r expressions).caught >>=
    callNext (n+5) Inv48.Source.model.core.table c r targets Inv48.RequestQuote.requestKey) trace (.ok (.normal final)) at run
  obtain ⟨v,bt,aft,split,first,last⟩ := bindSuccess _ _ _ _ run
  cases v with
  | error err => simp only [callNext] at last; cases last
  | ok pair =>
    obtain ⟨values,mid⟩ := pair
    cases entered : internalCallEnter? fn values mid with
    | none => simp only [callNext,registered,entered] at last; cases last
    | some pair =>
      obtain ⟨inner,saved⟩ := pair
      have bodyRun : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table
          {c with checked := true} inner fn.body >>= internalCallFinish fn targets saved) aft (.ok (.normal final)) := by
        simpa only [callNext,registered,entered] using last
      refine ⟨values,mid,bt,aft,split,first,?_⟩
      intro s p a b g eq hp ha hb hg
      have callEntry : internalCallEnter? fn (args s p a b g) mid = some (inner,saved) := by rwa [← eq]
      have reject : ∀ q err rest, ¬ Interaction.Executes
          (internalCallFinish fn targets saved (.reverted q err)) rest (.ok (.normal final)) := by
        intro q err rest bad
        simp only [internalCallFinish] at bad
        cases bad
      obtain ⟨localSite,joined,⟨cut⟩⟩ := shared n {c with checked := true} mid inner fn quoteFn saved s p a b g
        registered linked callEntry hp ha hb hg (internalCallFinish fn targets saved) aft (.normal final) reject bodyRun
      let q : Site (Stmt.eval (n+6) Inv48.Source.model.core.table c r
          (.internalCall targets Inv48.RequestQuote.requestKey expressions))
          Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace (.normal final) :=
        {localSite with
          before := bt ++ localSite.before
          split := split.trans ((congrArg (fun tr => bt ++ tr) localSite.split).trans (List.append_assoc _ _ _).symm)
          reached := by
            rw [Stmt.eval]
            change Prefix ((Expr.evalRefArgList c r expressions).caught >>=
              callNext (n+5) Inv48.Source.model.core.table c r targets Inv48.RequestQuote.requestKey) _ _
            apply (Prefix.ofExecution first _).trans
            simpa only [callNext,registered,entered] using localSite.reached}
      obtain ⟨⟨fuel,P,A,B,_⟩,origin,originEq⟩ := joined
      refine ⟨q,⟨⟨fuel,P,A,B,Inv48.SiteEntryBridge.concreteEntry q n p a b quoteFn linked hp ha hb fuel P A B⟩,origin,originEq⟩,?_⟩
      refine ⟨{ cut with
        before := bt ++ cut.before
        split := split.trans ((congrArg (fun tr => bt ++ tr) cut.split).trans (List.append_assoc _ _ _).symm)
        quoteBefore := congrArg (fun tr => bt ++ tr) cut.quoteBefore
        reached := ?_ }⟩
      dsimp only [q]
      rw [Stmt.eval]
      change Prefix ((Expr.evalRefArgList c r expressions).caught >>=
        callNext (n+5) Inv48.Source.model.core.table c r targets Inv48.RequestQuote.requestKey) _ _
      apply (Prefix.ofExecution first _).trans
      simpa only [callNext,registered,entered] using cut.reached
end Inv48.QuoteContinuationIdentity
