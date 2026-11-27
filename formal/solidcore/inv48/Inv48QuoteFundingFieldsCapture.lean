import Inv48QuoteFundingFieldsNormal
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.QuoteTransport
namespace Inv48.QuoteFundingFields
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- Direct specialization of captureBody: normal fallthrough is an output.
The rejection condition is necessary for arbitrary continuations, which could
otherwise turn a propagated revert into any chosen successful result. -/
theorem captureNormal (n : Nat) (c : Context)
    (caller callee : Runtime) (fn : InternalFunction) (saved : LocalEnv)
    (values : List Value) (k : Result → SolI Result)
    (trace : Interaction.Transcript) (out : Result)
    (arguments : Expr.evalRefArgList c caller
      [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] = pure (values,caller))
    (linked : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.quoteKey = some fn)
    (entered : internalCallEnter? fn values caller = some (callee,saved))
    (reject : ∀ r err tr, ¬ Interaction.Executes (k (.reverted r err)) tr (.ok out))
    (run : Interaction.Executes
      (Stmt.eval (n+2) Inv48.Source.model.core.table c caller
        Inv48.RequestQuote.quoteCaptureP.value >>= k) trace (.ok out)) :
    ∃ final bodyTrace afterTrace, trace = bodyTrace ++ afterTrace ∧
      Interaction.Executes
        (Stmt.eval n Inv48.Source.model.core.table {c with checked := true} callee fn.body)
        bodyTrace (.ok (.normal final)) ∧
      Interaction.Executes
        ((internalCallFinish fn [ret] saved (.normal final) >>= captureNext [ret]) >>= k)
        afterTrace (.ok out) := by
  obtain ⟨result,bt,aft,split,body,after⟩ := Inv48.FundingContinuation.captureBody
    n Inv48.Source.model.core.table c caller callee fn saved values k trace out
    arguments linked entered run
  rcases bodyOut n {c with checked := true} callee fn linked bt result body with
    ⟨final,h⟩ | ⟨final,err,h⟩
  · subst result
    exact ⟨final,bt,aft,split,body,after⟩
  · subst result
    change Interaction.Executes (k (.reverted final err)) aft (.ok out) at after
    exact False.elim (reject final err aft after)

#print axioms captureNormal
end Inv48.QuoteFundingFields
