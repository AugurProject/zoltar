import Inv48WrapperTraversalSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The literal invocation is inverted from the same completed wrapper run.
The selected call's transcript is a contiguous slice, and its real outer
continuation executes on the remaining slice. -/
theorem invocation (wrapper : FunctionDef) (p : Plan Inv48.Source.model.core.table wrapper.body)
    (n : Nat) (c : Context) (r : Runtime) (trace : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body)
      trace (.ok out)) :
    ∃ s : Site (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body)
        Inv48.Source.model.core.table (.internalCall p.targets Inv48.RequestQuote.requestKey p.args) trace out,
      s.fuel = n+4 ∧ ∃ final during rest, s.after = during++rest ∧
        Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table s.context s.runtime
          (.internalCall p.targets Inv48.RequestQuote.requestKey p.args)) during (.ok (.normal final)) ∧
        Interaction.Executes (s.continuation (.normal final)) rest (.ok out) := by
  have reject : Rejects pure out := by
    intro v bad tr exec
    cases exec
    exact ordinary bad
  have unit : (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body >>= pure) =
      Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body := Interaction.bind_pure _
  have result := site (p.build (n+4)) c r pure trace out reject (by rwa [unit])
  rw [unit] at result
  obtain ⟨s,fuel,rej⟩ := result
  rw [p.leaf] at fuel
  obtain ⟨v,during,rest,split,first,last⟩ := bindSuccess _ _ _ _ s.suffix
  have never := neverSound 1 (.internalCall p.targets Inv48.RequestQuote.requestKey p.args) rfl
    s.fuel Inv48.Source.model.core.table s.context s.runtime
  have normal : ∃ final, v = .normal final := by
    cases v with
    | normal final => exact ⟨final,rfl⟩
    | returned rt vs => exact False.elim (never _ _ _ first)
    | _ => apply False.elim; apply rej _ ?_ rest last; trivial
  obtain ⟨final,rfl⟩ := normal
  refine ⟨s,fuel,final,during,rest,split,?_,last⟩
  · simpa only [fuel] using first

theorem quote (wrapper : FunctionDef) (p : Plan Inv48.Source.model.core.table wrapper.body)
    (fn : InternalFunction) (registered : request = some fn)
    (n : Nat) (c : Context) (r : Runtime) (trace : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body)
      trace (.ok out)) :
    Nonempty (Site (Stmt.eval (n+4+p.depth) Inv48.Source.model.core.table c r wrapper.body)
      Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out) := by
  obtain ⟨s,fuel,final,during,rest,split,first,last⟩ := invocation wrapper p n c r trace out ordinary run
  obtain ⟨q,_⟩ := invocationQuote fn registered n s.context s.runtime final p.targets p.args during first
  refine ⟨⟨q.fuel,q.context,q.runtime,(fun v => q.continuation v >>= s.continuation),
    s.before++q.before,q.after++rest,?_,?_,?_⟩⟩
  · calc
      trace = s.before++s.after := s.split
      _ = s.before++(during++rest) := congrArg (fun tr => s.before++tr) split
      _ = s.before++((q.before++q.after)++rest) := congrArg (fun tr => s.before++(tr++rest)) q.split
      _ = _ := by simp only [List.append_assoc]
  · apply s.reached.trans
    have reached := q.reached.bind s.continuation
    simpa only [fuel,assoc] using reached
  · have suffix := Interaction.Executes.bind_ok q.suffix last
    change Interaction.Executes ((Stmt.eval q.fuel Inv48.Source.model.core.table q.context q.runtime
      Inv48.RequestQuote.quoteCaptureP.value >>= q.continuation) >>= s.continuation) (q.after++rest) (.ok out) at suffix
    simpa only [assoc] using suffix
end Inv48.WrapperTraversal
