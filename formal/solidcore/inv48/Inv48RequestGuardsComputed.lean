import Inv48RequestGuardsPublic
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- A certificate must be the output of evaluating the actual public entry
against these exact responder rows and bounds, not an arbitrary reached cut. -/
structure ComputedPublicQuote (fuel budget : Nat) (rows : ScriptedResponder)
    (c : Context) (state : State) (p a bounty : Nat) where
  quote : PublicQuote fuel c state p a bounty
  computed : publicQuote fuel budget rows c state p a bounty = some quote

def computePublicQuote (fuel budget : Nat) (rows : ScriptedResponder)
    (c : Context) (state : State) (p a bounty : Nat) :
    Option (ComputedPublicQuote fuel budget rows c state p a bounty) :=
  match computed : publicQuote fuel budget rows c state p a bounty with
  | none => none
  | some q => some ⟨q,computed⟩

/-- The transport's raw runtime and sponsor/gas/frame arguments are obtained
from computation. The only registration input is the actual quote lookup. -/
theorem computedInputs (certificate : ComputedPublicQuote fuel budget rows c state p a bounty)
    (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn) :
    let q := certificate.quote
    publicQuote fuel budget rows c state p a bounty = some q ∧
    q.fn.evalBodyEntry fuel Inv48.Source.model.core.table c state [.word p,.word a,.word bounty] =
      some (Stmt.eval fuel Inv48.Source.model.core.table c
        (Inv48.RequestPrologue.publicBase c state p a bounty) q.fn.body) ∧
    Prefix (Stmt.eval fuel Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) q.fn.body) q.cut.trace
      (Stmt.eval q.cut.siteFuel Inv48.Source.model.core.table {c with checked := true}
        (Inv48.RequestPrologue.caller q.raw []
          ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty q.gas::[]) p a bounty q.old q.hoisted)
        Inv48.RequestQuote.quoteCaptureP.value >>= q.cut.continuation) ∧
    Expr.evalRefArgList {c with checked := true} q.cut.runtime
      [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] =
      pure ([.word p,.word a,.word bounty],q.cut.runtime) ∧
    internalCallEnter? fn [.word p,.word a,.word bounty] q.cut.runtime =
      some (Inv48.WholeQuote.entry q.raw p a bounty,
        Inv48.QuoteTransport.saved []
          ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty q.gas::[]) p a bounty q.old q.hoisted) := by
  exact ⟨certificate.computed,publicQuoteInputs certificate.quote fn linked⟩

end Inv48.RequestGuards
