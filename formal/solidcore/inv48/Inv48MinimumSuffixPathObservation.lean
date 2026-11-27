import Inv48MinimumSuffixPathRounded
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuffixPath
open Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Extend the original two-helper observation without changing its helper
indices, price, context, transcript, result, or ABI finish. The dependent path
and rounded cut are both derived from that observation's body execution. -/
structure Observation (n : Nat) (c : Context) (state : State) (p : Nat)
    (trace : Interaction.Transcript) (out : ABI.AbiCallResult) where
  original : Inv48.RawMinimumResult.Observation (n+5) c state p trace out
  path : Path n c (Inv48.Positive.start (Inv48.Positive.entryBase c state) p) trace original.result
  rounded : Rounded path

theorem extend (s : Inv48.RawMinimumResult.Observation (n+5) c state p trace out)
    (success : out.success = true) : Nonempty (Observation n c state p trace out) := by
  have ordinary := Inv48.WrapperTraversal.successfulBodyOrdinary Inv48.PositiveABI.entry
    state s.result out (by rw [Inv48.PositiveABI.metadata.2.2.2.2]; rfl) s.finish success
  obtain ⟨path⟩ := recover n c _ trace s.result ordinary s.body
  obtain ⟨cut⟩ := rounded path ordinary
  exact ⟨⟨s,path,cut⟩⟩

/-- Actual argument evaluation of the reached rounded invocation. Values are
not identified with the original helper words until the saved-local transport
obligation is discharged. In particular this theorem supplies no arithmetic
budget and assumes no separate suffix run. -/
theorem reachedArguments (s : Observation n c state p trace out) :
    ∃ values mid argumentTrace remaining,
      s.rounded.callTrace = argumentTrace ++ remaining ∧
      Interaction.Executes (Expr.evalRefArgList c s.rounded.caller
        [.var Inv48.Positive.a0,.var Inv48.Positive.a1,.var Inv48.Positive.a2,.var Inv48.Positive.a3]).caught
        argumentTrace (.ok (.ok (values,mid))) := by
  have run := s.rounded.callRun
  rw [Stmt.eval] at run
  change Interaction.Executes ((Expr.evalRefArgList c s.rounded.caller
    [.var Inv48.Positive.a0,.var Inv48.Positive.a1,.var Inv48.Positive.a2,.var Inv48.Positive.a3]).caught >>=
      Inv48.RequestGuards.callNext n Inv48.Source.model.core.table c s.rounded.caller
        [Inv48.Positive.roundRet] Inv32Bodies.Ceil.key) s.rounded.callTrace
        (.ok (.normal s.rounded.callFinal)) at run
  obtain ⟨result,at_,rest,split,first,last⟩ := Inv48.RequestDispatch.bindSuccess _ _ _ _ run
  cases result with
  | error err =>
    simp only [Inv48.RequestGuards.callNext] at last
    cases last
  | ok pair =>
    obtain ⟨values,mid⟩ := pair
    exact ⟨values,mid,at_,rest,split,first⟩

#print axioms extend
#print axioms reachedArguments
end Inv48.MinimumSuffixPath
