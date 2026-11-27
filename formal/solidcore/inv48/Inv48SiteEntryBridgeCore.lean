import Inv48PublicQuoteTransferCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.SiteEntryBridge
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

/-- Entry needs the three actual argument lookups, not an exact spelling of
unrelated saved locals. The saved environment is the observed runtime's own. -/
theorem concreteEntry {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (s : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a bounty : Nat) (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (hp : p < 2^256) (ha : a < 2^256) (hb : bounty < 2^256)
    (fuel : s.fuel = n+2)
    (P : s.runtime.lookupLocal? "_ic_arg_0" = some (.word p))
    (A : s.runtime.lookupLocal? "_ic_arg_1" = some (.word a))
    (B : s.runtime.lookupLocal? "_ic_arg_2" = some (.word bounty)) :
    ∃ result bodyTrace afterTrace,
      trace = s.before ++ bodyTrace ++ afterTrace ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table
        {s.context with checked := true}
        (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base s.runtime) p a bounty) fn.body)
        bodyTrace (.ok result) ∧
      Interaction.Executes
        ((internalCallFinish fn [Inv48.QuoteTransport.ret] s.runtime.locals result >>=
          Inv48.RequestGuards.captureNext [Inv48.QuoteTransport.ret]) >>= s.continuation)
        afterTrace (.ok out) := by
  have initial := Inv48.RequestPrologue.registeredInitial fn linked p a bounty hp ha hb
  have arguments := Inv48.RequestQuote.quoteCallInputs s.context s.runtime p a bounty P A B
  have enter : internalCallEnter? fn [.word p,.word a,.word bounty] s.runtime =
      some (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base s.runtime) p a bounty,
        s.runtime.locals) := by
    simp [internalCallEnter?,initial,Inv48.WholeQuote.entry,
      Inv48.RequestPrologue.base,Runtime.withFrame]
  have run := s.suffix
  rw [fuel] at run
  obtain ⟨result,bt,aft,split,body,after⟩ :=
    Inv48.FundingContinuation.captureBody n Inv48.Source.model.core.table s.context
      s.runtime (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base s.runtime) p a bounty)
      fn s.runtime.locals [.word p,.word a,.word bounty] s.continuation s.after out
      arguments linked enter run
  exact ⟨result,bt,aft,s.split.trans ((congrArg (fun tr => s.before ++ tr) split).trans
    (List.append_assoc _ _ _).symm),body,after⟩
end Inv48.SiteEntryBridge
