import Inv48WrapperArgsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestDispatch
namespace Inv48.WrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

/-- Actual internal-body entry for the five evaluated values. The call is the
real executed statement, and the body and finish retain contiguous trace slices.
TempValues is a residual premise, not disguised as a decoded-input theorem. -/
theorem actualEntry (n : Nat) (c : Context) (r final : Runtime)
    (targets : List String) (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (s p a b g : Nat) (values : TempValues r s p a b g)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.internalCall targets Inv48.RequestQuote.requestKey callArgs)) trace (.ok (.normal final))) :
    ∃ result bodyTrace finishTrace,
      trace = bodyTrace ++ finishTrace ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {c with checked := true}
        (Inv48.GuardArgsFrame.entry r s p a b g) fn.body) bodyTrace (.ok result) ∧
      Interaction.Executes (internalCallFinish fn targets r.locals result)
        finishTrace (.ok (.normal final)) ∧
      Inv48.GuardArgsFrame.Lookups (Inv48.GuardArgsFrame.entry r s p a b g) p a b := by
  rw [Stmt.eval] at run
  dsimp only at run
  rw [evaluated c r s p a b g values] at run
  simp only [registered] at run
  have enter := Inv48.GuardArgsFrame.entered fn registered r s p a b g
  change internalCallEnter? fn (inputs s p a b g) r = _ at enter
  change Interaction.Executes (match internalCallEnter? fn (inputs s p a b g) r with
    | none => pure (.reverted r .typeMismatch)
    | some (inner,saved) => Stmt.eval n Inv48.Source.model.core.table
        {c with checked := true} inner fn.body >>= internalCallFinish fn targets saved)
    trace (.ok (.normal final)) at run
  rw [enter] at run
  change Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {c with checked := true}
      (Inv48.GuardArgsFrame.entry r s p a b g) fn.body >>= internalCallFinish fn targets r.locals) trace (.ok (.normal final)) at run
  obtain ⟨result,bt,ft,split,body,finish⟩ := bindSuccess _ _ _ _ run
  exact ⟨result,bt,ft,split,body,finish,Inv48.GuardArgsFrame.entryLookups r s p a b g⟩

/-- Specialize the occurrence recovered by bothRawQuote once its argument
lookup bridge is available. No independently chosen successful call is used. -/
theorem recoveredEntry {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (targets : List String) (n : Nat)
    (recovered : Inv48.WrapperTraversal.Recovered root targets callArgs trace out (n+1))
    (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (s p a b g : Nat)
    (bridge : ∀ site : Site root Inv48.Source.model.core.table
      (.internalCall targets Inv48.RequestQuote.requestKey callArgs) trace out,
      site.fuel = n+1 → TempValues site.runtime s p a b g) :
    ∃ site : Site root Inv48.Source.model.core.table
      (.internalCall targets Inv48.RequestQuote.requestKey callArgs) trace out,
      site.fuel = n+1 ∧ ∃ result bt ft rest final,
      site.after = (bt++ft)++rest ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table
        {site.context with checked := true}
        (Inv48.GuardArgsFrame.entry site.runtime s p a b g) fn.body) bt (.ok result) ∧
      Interaction.Executes (internalCallFinish fn targets site.runtime.locals result)
        ft (.ok (.normal final)) ∧
      Interaction.Executes (site.continuation (.normal final)) rest (.ok out) := by
  obtain ⟨site,fuel,final,during,rest,split,call,after⟩ := recovered
  obtain ⟨result,bt,ft,splitCall,body,finish,_⟩ :=
    actualEntry n site.context site.runtime final targets fn registered s p a b g
      (bridge site fuel) during call
  exact ⟨site,fuel,result,bt,ft,rest,final,by simpa [splitCall] using split,body,finish,after⟩
end Inv48.WrapperArgs
