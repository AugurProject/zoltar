import Inv48FundingMinimumObservedSource
import Inv48PublicObservedQuoteActual
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.FundingMinimumObserved
open Inv48.WrapperTraversal Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Actual successful quote execution supplies the numerical getter path.
No successful standalone getter or duplicate exposure input is accepted. -/
theorem fromQuote (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (hp : p < Inv32Division.R) (ha : a < Inv32Division.R) (hb : bounty < Inv32Division.R)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (Inv48.WholeQuote.entry physical p a bounty) Inv48.WholeQuote.bodyP.value) trace (.ok out)) :
    ∃ base bt value before after,
      trace = before ++ bt ++ after ∧
      Nonempty (Body (n+4) {c with checked := true} base p bt value) := by
  have replay := Inv48.CollateralCloneFuel.replay (show n+5 ≤ (n+10)+5 by omega)
    _ _ _ _ _ _ run
  obtain ⟨s⟩ := Inv48.MinimumFullTrace.quoteRecovery (n+10) c physical p a bounty
    hp ha hb trace out ordinary replay
  have P : (Inv48.WholeQuote.prepared physical p a bounty).lookupLocal? "proposedRepPerEthPrice" =
      some (.word p) := rfl
  obtain ⟨base,bt,value,before,after,sp,ord,body⟩ := minimumBody n c _ s.minimumFinal p hp P
    s.minimumTrace s.minimumRun
  refine ⟨base,bt,value,before,after++s.quoteAfter,?_,?_⟩
  · exact s.quoteSplit.trans ((congrArg (fun t => t ++ s.quoteAfter) sp).trans
      (by simp only [List.append_assoc]))
  · exact recoverBody (n+4) _ base p bt value ord body

/-- Funding's existing reached quote cut is sufficient. It is opened before
any minInputs replay and uses the original continuation to exclude reversion. -/
theorem atFundingCut {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (cut : Inv48.QuoteContinuationIdentity.Cut q (n+5) p a b)
    (joined : Inv48.ObservedQuoteJoin.Site.Joined q (n+5) p a b fn)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (cut.next (.reverted mid err)) rest (.ok out))
    (hp : p < Inv32Division.R) (ha : a < Inv32Division.R) (hb : b < Inv32Division.R) :
    ∃ base bt value before after,
      trace = before ++ bt ++ after ∧
      Nonempty (Body (n+4) {{q.context with checked := true} with checked := true} base p bt value) := by
  obtain ⟨post,qt,aft,sp,body,_⟩ := Inv48.PublicObservedQuote.normalAtCut q (n+5) p a b fn
    linked cut joined reject
  have shape := Inv48.WholeQuote.actualBody
  rw [linked] at shape
  have bodyEq : fn.body = Inv48.WholeQuote.bodyP.value := Option.some.inj shape
  rw [bodyEq] at body
  obtain ⟨base,bt,value,before,after,inner,cert⟩ := fromQuote n _ _ p a b hp ha hb qt
    (.normal post) (by simp [Escapes]) body
  refine ⟨base,bt,value,q.before++before,after++aft,?_,cert⟩
  exact sp.trans ((congrArg (fun t => q.before ++ t ++ aft) inner).trans
    (by simp only [List.append_assoc]))

#print axioms fromQuote
#print axioms atFundingCut
end Inv48.FundingMinimumObserved
