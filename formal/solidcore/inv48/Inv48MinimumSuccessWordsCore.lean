import Inv48MinimumSuccessInvertPublic
import Inv48ExposureDecoded
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessWords
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.MinimumSuccessInvert
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The callee belongs to the recovered invocation. Its entry runtime and its
transcript are recovered, rather than supplied as an independent successful run. -/
def Entered (fuel : Nat) (table : FunctionTable) (c : Context) (r : Runtime)
    (targets : List String) (key : String) (trace : Interaction.Transcript)
    (final : Runtime) : Prop :=
  ∃ n fn inner saved value bodyTrace finishTrace,
    fuel = n+1 ∧ table.lookup? key = some fn ∧
    internalCallEnter? fn [] r = some (inner,saved) ∧
    trace = bodyTrace ++ finishTrace ∧
    Interaction.Executes (Stmt.eval n table {c with checked := true} inner fn.body)
      bodyTrace (.ok value) ∧
    Interaction.Executes (internalCallFinish fn targets saved value)
      finishTrace (.ok (.normal final)) ∧ ¬ Inv48.WrapperTraversal.Escapes value

theorem enter (fuel : Nat) (table : FunctionTable) (c : Context) (r : Runtime)
    (targets : List String) (key : String) (trace : Interaction.Transcript) (final : Runtime)
    (run : Interaction.Executes (Stmt.eval fuel table c r (.internalCall targets key []))
      trace (.ok (.normal final))) : Entered fuel table c r targets key trace final := by
  cases fuel with
  | zero => simp only [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    change Interaction.Executes ((Expr.evalRefArgList c r []).caught >>=
      callNext n table c r targets key) trace (.ok (.normal final)) at run
    have args : (Expr.evalRefArgList c r []).caught = pure (.ok ([],r)) := rfl
    rw [args] at run
    change Interaction.Executes (callNext n table c r targets key (.ok ([],r)))
      trace (.ok (.normal final)) at run
    cases found : table.lookup? key with
    | none => simp only [callNext,found] at run; cases run
    | some fn =>
      cases entered : internalCallEnter? fn [] r with
      | none => simp only [callNext,found,entered] at run; cases run
      | some pair =>
        obtain ⟨inner,saved⟩ := pair
        have body : Interaction.Executes (Stmt.eval n table {c with checked := true} inner fn.body >>=
            internalCallFinish fn targets saved) trace (.ok (.normal final)) := by
          simpa only [callNext,found,entered] using run
        obtain ⟨value,bt,ft,split,first,last⟩ := bindSuccess _ _ _ _ body
        refine ⟨n,fn,inner,saved,value,bt,ft,rfl,found,entered,split,first,last,?_⟩
        cases value <;> simp [Inv48.WrapperTraversal.Escapes]
        all_goals simp only [internalCallFinish] at last; cases last

/-- Keep the original public site, prefix, suffix and actual normal caller result
while descending to the checked callee. -/
def CompletedBody (fuel : Nat) (c : Context) (r : Runtime) (trace : Interaction.Transcript)
    (out : Result) (targets : List String) (key : String) : Prop :=
  ∃ s : Inv48.RequestClassify.Site (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table (.internalCall targets key []) trace out,
    ∃ final during rest, s.after = during ++ rest ∧
      Entered s.fuel Inv48.Source.model.core.table s.context s.runtime targets key during final ∧
      Interaction.Executes (s.continuation (.normal final)) rest (.ok out)

theorem completedBody (h : Completed fuel c r trace out (.internalCall targets key [])) :
    CompletedBody fuel c r trace out targets key := by
  obtain ⟨s,final,during,rest,split,run,last⟩ := h
  exact ⟨s,final,during,rest,split,enter _ _ _ _ _ _ _ _ run,last⟩
end Inv48.MinimumSuccessWords
