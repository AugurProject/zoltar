import Inv48WrapperTraversalPublic
import Inv48RequestPrologueShape
import Inv48FundingContinuationSite
import Inv48ChildExtractionSafety
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PublicQuoteTransfer
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

/-- The remaining entry bridge is a runtime/frame equality, not a reached-site,
returned-field, or separately executed helper assumption. It must be proved
for the site produced by `bothRawQuote`, not supplied as environment data. -/
def EntryBridge {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (s : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n : Nat) (physical : Runtime) (frame : Frame) (rest : LocalEnv)
    (p a bounty old hoisted : Nat) : Prop :=
  s.fuel = n+2 ∧ s.runtime =
    Inv48.RequestPrologue.caller physical frame rest p a bounty old hoisted

/-- Once the entry bridge is discharged, concrete callee entry and the saved
frames are derived from registration. The body and epilogue are extracted
from the selected public trace, never postulated as independent executions. -/
theorem concreteEntry {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (s : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n : Nat) (physical : Runtime) (frame : Frame) (rest : LocalEnv)
    (p a bounty old hoisted : Nat)
    (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (hp : p<2^256) (ha : a<2^256) (hb : bounty<2^256)
    (bridge : EntryBridge s n physical frame rest p a bounty old hoisted) :
    ∃ result bodyTrace afterTrace,
      trace = s.before ++ bodyTrace ++ afterTrace ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table
        {s.context with checked := true}
        (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base physical) p a bounty) fn.body)
        bodyTrace (.ok result) ∧
      Interaction.Executes
        ((internalCallFinish fn [Inv48.QuoteTransport.ret]
          (Inv48.QuoteTransport.saved frame rest p a bounty old hoisted) result >>=
          Inv48.RequestGuards.captureNext [Inv48.QuoteTransport.ret]) >>= s.continuation)
        afterTrace (.ok out) := by
  obtain ⟨fuel,runtime⟩ := bridge
  have initial := Inv48.RequestPrologue.registeredInitial fn linked p a bounty hp ha hb
  have run := s.suffix
  rw [fuel,runtime] at run
  obtain ⟨result,bt,aft,split,body,after⟩ :=
    Inv48.FundingContinuation.captureBody n Inv48.Source.model.core.table s.context
      (Inv48.RequestPrologue.caller physical frame rest p a bounty old hoisted)
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base physical) p a bounty)
      fn (Inv48.QuoteTransport.saved frame rest p a bounty old hoisted)
      [.word p,.word a,.word bounty] s.continuation s.after out
      (Inv48.RequestPrologue.arguments s.context physical frame rest p a bounty old hoisted)
      linked (Inv48.RequestPrologue.enter fn physical frame rest p a bounty old hoisted initial) run
  exact ⟨result,bt,aft,s.split.trans ((congrArg (fun tr => s.before ++ tr) split).trans (List.append_assoc _ _ _).symm),body,after⟩
/-- A computed quote result can identify the result of the extracted public
slice only after every answer in that slice is aligned with the same rows.
This prevents replacing the observed execution with a separate scripted run. -/
theorem observedResult {α : Type} (tree : SolI α) (rows : ScriptedResponder)
    (trace : Interaction.Transcript) (actual computed : α)
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (run : Interaction.Executes tree trace (.ok actual))
    (evaluation : tree.runWith rows = .ok computed) : actual = computed := by
  have folded := Inv48.ChildExtraction.foldTrace rows tree trace actual aligned run
  exact Except.ok.inj (folded.symm.trans evaluation)
end Inv48.PublicQuoteTransfer
