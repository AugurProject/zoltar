import Inv48FundingContinuationCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.EscrowPrefix Inv48.QuoteTransport Inv48.RequestDispatch Inv48.RequestGuards
namespace Inv48.FundingContinuation
set_option autoImplicit false
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- Extract the real callee execution from a reached quote capture. The
callee result and epilogue are outputs, never assumed successful helpers. -/
theorem captureBody (n : Nat) (table : FunctionTable) (c : Context)
    (caller callee : Runtime) (fn : InternalFunction) (saved : LocalEnv)
    (values : List Value) (k : Result → SolI Result)
    (trace : Interaction.Transcript) (out : Result)
    (arguments : Expr.evalRefArgList c caller
      [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] = pure (values,caller))
    (linked : table.lookup? Inv48.RequestQuote.quoteKey = some fn)
    (entered : internalCallEnter? fn values caller = some (callee,saved))
    (run : Interaction.Executes
      (Stmt.eval (n+2) table c caller Inv48.RequestQuote.quoteCaptureP.value >>= k)
      trace (.ok out)) :
    ∃ result bodyTrace afterTrace, trace = bodyTrace ++ afterTrace ∧
      Interaction.Executes (Stmt.eval n table {c with checked := true} callee fn.body)
        bodyTrace (.ok result) ∧
      Interaction.Executes
        ((internalCallFinish fn [ret] saved result >>= captureNext [ret]) >>= k)
        afterTrace (.ok out) := by
  change Interaction.Executes
    (Stmt.eval (n+2) table c caller
      (.captureReturn [ret] (.internalCall [ret] Inv48.RequestQuote.quoteKey
        [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"])) >>= k) trace (.ok out) at run
  rw [Stmt.eval] at run
  change Interaction.Executes
    ((Stmt.eval (n+1) table c caller
      (.internalCall [ret] Inv48.RequestQuote.quoteKey
        [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"]) >>=
      captureNext [ret]) >>= k) trace (.ok out) at run
  have call : Stmt.eval (n+1) table c caller
      (.internalCall [ret] Inv48.RequestQuote.quoteKey
        [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"]) =
      (Stmt.eval n table {c with checked := true} callee fn.body >>=
        internalCallFinish fn [ret] saved) := by
    rw [Stmt.eval]
    dsimp only
    rw [arguments]
    change (match table.lookup? Inv48.RequestQuote.quoteKey with
      | none => pure (Result.reverted caller RevertData.typeMismatch)
      | some f => match internalCallEnter? f values caller with
        | none => pure (Result.reverted caller RevertData.typeMismatch)
        | some (i,s) => Stmt.eval n table {c with checked := true} i f.body >>=
            internalCallFinish f [ret] s) = _
    simp only [linked,entered]
  rw [call,assoc,assoc] at run
  obtain ⟨result,bt,aft,split,body,after⟩ := bindSuccess _ _ _ _ run
  exact ⟨result,bt,aft,split,body,by simpa only [assoc] using after⟩

#print axioms captureBody
end Inv48.FundingContinuation
