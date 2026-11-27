import Inv48ObservedEscrowJoinCapture
import Inv48ObservedQuoteJoinSite
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
namespace Inv48.QuoteContinuationIdentity
open Inv48.ActualSiteGuardJoin Inv48.SiteEntryBridge
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem quoteBlockSite (n : Nat) (c : Context) (r : Runtime)
    (p a bounty : Nat) (hp : p < 2^256) (ha : a < 2^256) (hb : bounty < 2^256)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes
      (Stmt.eval (n+3) Inv48.Source.model.core.table c r
        Inv48.RequestPrologue.quoteBlockP.value >>= k) trace (.ok out)) :
    ∃ s : Inv48.RequestClassify.Site
      (Stmt.eval (n+3) Inv48.Source.model.core.table c r
        Inv48.RequestPrologue.quoteBlockP.value >>= k)
      Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
      s.fuel = n+2 ∧ s.runtime = prepared r p a bounty ∧
      s.runtime.lookupLocal? "_ic_arg_0" = some (.word p) ∧
      s.runtime.lookupLocal? "_ic_arg_1" = some (.word a) ∧
      s.runtime.lookupLocal? "_ic_arg_2" = some (.word bounty) ∧
      s.continuation = (fun v => (listNext (n+2) Inv48.Source.model.core.table c
        [Inv48.QuoteTransport.aliasP.value] v >>= pop) >>= k) ∧
      s.before = [] ∧ s.after = trace ∧ s.context = c := by
  have tree :
      (Stmt.eval (n+3) Inv48.Source.model.core.table c r
        Inv48.RequestPrologue.quoteBlockP.value >>= k) =
      (Stmt.eval (n+2) Inv48.Source.model.core.table c (prepared r p a bounty)
        Inv48.RequestQuote.quoteCaptureP.value >>= fun v =>
          (listNext (n+2) Inv48.Source.model.core.table c
            [Inv48.QuoteTransport.aliasP.value] v >>= pop) >>= k) := by
    change (Stmt.eval ((n+2)+1) _ c r
      (.block (Inv48.RequestPrologue.quotePrefix ++
        Inv48.RequestQuote.quoteCaptureP.value :: [Inv48.QuoteTransport.aliasP.value])) >>= k) = _
    rw [blockSplit,prefixExecution (n+1) _ c r p a bounty hp ha hb P A B]
    change ((Stmt.eval (n+2) _ c (prepared r p a bounty) _ >>= _) >>= _) >>= k = _
    simp only [assoc]
  refine ⟨⟨n+2,c,prepared r p a bounty,(fun v => (listNext (n+2) Inv48.Source.model.core.table c [Inv48.QuoteTransport.aliasP.value] v >>= pop) >>= k),[],trace,by simp,?_,?_⟩,
    rfl,rfl,(preparedLookups r p a bounty).1,
    (preparedLookups r p a bounty).2.1,(preparedLookups r p a bounty).2.2,rfl,rfl,rfl,rfl⟩
  · rw [tree]
    exact .refl _
  · rwa [← tree]

end Inv48.QuoteContinuationIdentity
