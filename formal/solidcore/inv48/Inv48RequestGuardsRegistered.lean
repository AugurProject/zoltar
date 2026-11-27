import Inv48RequestGuardsComputed
import Inv48RequestGuardsConcrete
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

theorem quoteRegistered : ∃ fn,
    Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn := by
  have body := Inv48.WholeQuote.actualBody
  cases found : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey with
  | none => simp only [found,Option.map_none] at body; contradiction
  | some fn => exact ⟨fn,rfl⟩

/-- All entry-side arguments needed to select registeredTransport's caller.
Quote-body and suffix hypotheses remain that theorem's separate obligations. -/
structure TransportEntry (q : PublicQuote fuel c state p a bounty) where
  fn : InternalFunction
  registered : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn
  publicEntry : q.fn.evalBodyEntry fuel Inv48.Source.model.core.table c state [.word p,.word a,.word bounty] =
    some (Stmt.eval fuel Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) q.fn.body)
  caller : q.cut.runtime = Inv48.RequestPrologue.caller q.raw []
    ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty q.gas::[]) p a bounty q.old q.hoisted
  fuelExact : q.transportFuel+24 = q.cut.siteFuel
  reachability : Prefix (Stmt.eval fuel Inv48.Source.model.core.table c
    (Inv48.RequestPrologue.publicBase c state p a bounty) q.fn.body) q.cut.trace
    (Stmt.eval q.cut.siteFuel Inv48.Source.model.core.table {c with checked := true}
      q.cut.runtime Inv48.RequestQuote.quoteCaptureP.value >>= q.cut.continuation)
  arguments : Expr.evalRefArgList {c with checked := true} q.cut.runtime
    [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] =
    pure ([.word p,.word a,.word bounty],q.cut.runtime)
  entered : internalCallEnter? fn [.word p,.word a,.word bounty] q.cut.runtime =
    some (Inv48.WholeQuote.entry q.raw p a bounty,
      Inv48.QuoteTransport.saved []
        ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty q.gas::[]) p a bounty q.old q.hoisted)

theorem computedRegisteredEntry
    (certificate : ComputedPublicQuote fuel budget rows c state p a bounty) :
    Nonempty (TransportEntry certificate.quote) := by
  let q := certificate.quote
  obtain ⟨fn,registered⟩ := quoteRegistered
  have input := publicQuoteInputs q fn registered
  refine ⟨⟨fn,registered,input.1,q.callerRuntime,q.transportFuelExact,?_,input.2.2.1,input.2.2.2⟩⟩
  simpa only [← q.callerRuntime] using input.2.1

/-- Closed entry-side certificate for the explicit canonical echo-world case. -/
theorem concreteTransportEntry : Nonempty (TransportEntry Concrete.quote) :=
  computedRegisteredEntry Concrete.certificate

end Inv48.RequestGuards
