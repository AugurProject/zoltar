import Inv48QuoteContinuationIdentityRecovered
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
namespace Inv48.QuoteContinuationIdentity
open Inv48.ActualSiteGuardJoin Inv48.SiteEntryBridge
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem recoveredObserved {root : SolI Result} {out : Result}
    (n helperFuel budget : Nat) (rows : ScriptedResponder)
    (observed : Inv48.NestedResponder.Observation root)
    (computed : Inv48.NestedResponder.observe budget rows root = some observed)
    (targets : List String) (expressions : List Expr)
    (found : Inv48.WrapperTraversal.Recovered root targets expressions observed.trace out
      ((n+helperFuel+67)+6))
    (fn quoteFn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some quoteFn) :
    Inv48.ChildExtraction.Matches rows observed.trace ∧
    ∃ callSite : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
        (.internalCall targets Inv48.RequestQuote.requestKey expressions) observed.trace out,
      ∃ values mid argumentTrace,
        Interaction.Executes (Expr.evalRefArgList callSite.context callSite.runtime expressions).caught
          argumentTrace (.ok (.ok (values,mid))) ∧
        ∀ s p a b g, values = Inv48.GuardArgsFrame.args s p a b g →
          p < 2^256 → a < 2^256 → b < 2^256 → g < 2^32 →
          ∃ q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
              Inv48.RequestQuote.quoteCaptureP.value observed.trace out,
            Inv48.ObservedQuoteJoin.Site.Joined q (n+helperFuel+67) p a b quoteFn ∧
            Nonempty (Cut q (n+helperFuel+67) p a b) := by
  exact ⟨Inv48.ChildExtraction.observedMatches budget rows root observed computed,
    recovered (n+helperFuel+67) targets expressions found fn quoteFn registered linked⟩

end Inv48.QuoteContinuationIdentity
