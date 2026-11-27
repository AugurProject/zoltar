import Inv48ObservedMinimumGuardBody
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumGuard
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- Restrict the funding observation's responder agreement to an actual
contiguous slice. No second oracle or exposure agreement is introduced. -/
theorem foldSlice {α : Type} (rows : ScriptedResponder) (tree : SolI α)
    (whole before during after : Interaction.Transcript) (out : α)
    (split : whole = before ++ during ++ after)
    (aligned : Inv48.ChildExtraction.Matches rows whole)
    (run : Interaction.Executes tree during (.ok out)) : tree.runWith rows = .ok out := by
  apply Inv48.ChildExtraction.foldTrace rows tree during out _ run
  intro event member
  apply aligned event
  rw [split]
  exact List.mem_append_left _ (List.mem_append_right _ member)

/-- Existing fee/escrow continuations can consume this runtime directly.
The suffix is untouched and is run under the same responder. -/
theorem continueAfterMinimum (fuel : Nat) (c : Context) (r final : Runtime)
    (rows : ScriptedResponder) (tail : List Stmt)
    (stage : (Stmt.eval (fuel+1) Inv48.Source.model.core.table c r
      Inv48.WholeQuote.minP.value).runWith rows = .ok (.normal (afterBase r final))) :
    (Stmt.evalList (fuel+1) Inv48.Source.model.core.table c r
      (Inv48.WholeQuote.minP.value :: tail)).runWith rows =
      (Stmt.evalList (fuel+1) Inv48.Source.model.core.table c (afterBase r final) tail).runWith rows := by
  rw [Stmt.evalList,Inv48.PositiveRuns.bind,stage]
  rfl

#print axioms foldSlice
#print axioms continueAfterMinimum
end Inv48.ObservedMinimumGuard
