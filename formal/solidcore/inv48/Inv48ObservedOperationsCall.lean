import Inv48RawEscrowScheduleOperationsEntry
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedOperationsCall
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

theorem callOfBody (k : Nat) (c : Context) (r final : Runtime)
    (s p a b gas : Nat) (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (temps : Inv48.WrapperArgs.TempValues r s p a b gas)
    (bodyResult : Result) (bt ft : Interaction.Transcript)
    (bodyRun : Interaction.Executes (Stmt.eval k Inv48.Source.model.core.table
      {c with checked := true} (Inv48.GuardArgsFrame.entry r s p a b gas) fn.body) bt (.ok bodyResult))
    (finishRun : Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"] r.locals bodyResult)
      ft (.ok (.normal final))) :
    Interaction.Executes (Stmt.eval (k+1) Inv48.Source.model.core.table c r Inv48.SimpleWrapperArgs.call)
      (bt++ft) (.ok (.normal final)) := by
  have evaluated := Inv48.WrapperArgs.evaluated c r s p a b gas temps
  have entered := Inv48.GuardArgsFrame.entered fn registered r s p a b gas
  change internalCallEnter? fn (Inv48.WrapperArgs.inputs s p a b gas) r = _ at entered
  have joined := Interaction.Executes.bind_ok bodyRun finishRun
  unfold Inv48.SimpleWrapperArgs.call
  rw [Stmt.eval]
  dsimp only
  rw [evaluated]
  simp only [registered]
  change Interaction.Executes (match internalCallEnter? fn (Inv48.WrapperArgs.inputs s p a b gas) r with
    | none => pure (.reverted r .typeMismatch)
    | some (inner,saved) => Stmt.eval k Inv48.Source.model.core.table
      {c with checked := true} inner fn.body >>= internalCallFinish fn ["_ret__requestPrice_0"] saved) _ _
  rw [entered]
  exact joined
#print axioms callOfBody
end Inv48.ObservedOperationsCall
