import Inv48ObservedSuffixBoundsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.ObservedSuffixBounds
open Inv48.WholeQuote Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem atFundingCut {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (s : Inv48.MinimumGuardSiteJoin.FundingTrace q n p a b fn rows)
    (hp : p<R) (ha : a<R) (hb : b<R)
    (id oldA oldB h e v : Nat)
    (ref : s.recovery.cut.minimumFinal.lookupLocal? "quote" = some (.memoryRef id))
    (mem : s.recovery.cut.minimumFinal.loadMemory? id = some (tuple oldA oldB h e v))
    (A : s.recovery.cut.minimumFinal.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (P : s.recovery.cut.minimumFinal.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (run : Interaction.Executes (Stmt.eval (n+55) Inv48.Source.model.core.table
      {q.context with checked := true} (entry (Inv48.RequestPrologue.base q.runtime) p a b)
      bodyP.value) s.quoteTrace (.ok (.normal s.post))) :
    Inv48.QuoteExec.repAmount a p<R ∧
    ∃ last mt st, s.quoteTrace = mt ++ st ∧
      Interaction.Executes (Stmt.evalList (n+53) Inv48.Source.model.core.table
        {q.context with checked := true}
        (put (Inv32OneArg.store (put s.recovery.cut.minimumFinal id a oldB h e v)
          Inv32CeilFlags.h0 (Inv48.QuoteExec.repAmount a p)) id a (Inv48.QuoteExec.repAmount a p) h e v)
        tailCode) st (.ok (.normal last)) ∧ last.popScope.popScope = s.post := by
  obtain ⟨last,mt,st,split,suffix,pop⟩ := Inv48.ObservedFundingSuffix.atFundingCut q n p a b fn rows s hp ha hb run
  change Interaction.Executes (Stmt.evalList (n+53) _ _ _
    ((collateralWrite :: fundingCode) ++ tailCode)) _ _ at suffix
  have eq : n+53=(n+17)+36 := by omega
  rw [eq] at suffix
  obtain ⟨fits,tail⟩ := fundedTail (n+17) _ _ last id oldA oldB h e v a p ref mem A P ha hp tailCode st suffix
  rw [← eq] at tail
  exact ⟨fits,last,mt,st,split,tail,pop⟩
#print axioms atFundingCut
end Inv48.ObservedSuffixBounds
