import Inv48NestedResponderGenerated
import Inv48QuoteExecCore
import Inv48EscrowEntryFinal
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.EscrowPrefix
namespace Inv48.PublicInvariant

/-- The actual child context, with the same ABI entry and live parent state. -/
def childContext (c : Context) (data : List Byte) : Context :=
  ABI.Contract.callContextAtWithBase Inv48.Source.model.core {c with selfDispatch? := none}
    c.self c.self 0 data

/-- Missing execution extraction, not an external-world assumption.
The trace must be this computed child's trace, not a fresh successful run.
No declaration asserts that this proposition has been proved. -/
def SuccessfulBodyExtraction (c : Context) (state : State)
    (payer sponsor a p halt bounty gas fuel budget : Nat) (rows : ScriptedResponder)
    (served : Inv48.NestedResponder.Served c state
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows) : Prop :=
  served.result.success = true →
    ∃ (k : Nat) (final : Runtime) (tree : SolI Result),
      fuel = k+47 ∧
      Inv48.EscrowEntry.fn.evalBodyEntry (k+47) Inv48.Source.model.core.table
        (childContext c (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas)) state
        (Inv48.EscrowEntry.arguments payer sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas)
        = some tree ∧
      ExecutesOK tree served.nested.observed.trace (.normal final)

#print axioms SuccessfulBodyExtraction
end Inv48.PublicInvariant
