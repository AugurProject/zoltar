import Inv48QuoteContinuationIdentityShared
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestDispatch
namespace Inv48.QuoteContinuationIdentity
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

private theorem pureNext {α β : Type} (x : α) (k : α → SolI β) :
    (pure x >>= k : SolI β) = k x := rfl

/-- The two cuts are the same interaction tree after the pure generated
prefix, not merely independently successful executions with matching outputs. -/
theorem sourceTree {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (cut : Cut q n p a b) :
    (Stmt.evalList (n+3) Inv48.Source.model.core.table q.context cut.start
      (Inv48.RequestQuote.actual.drop 6) >>= cut.next) =
    (Stmt.eval (n+2) Inv48.Source.model.core.table q.context q.runtime
      Inv48.RequestQuote.quoteCaptureP.value >>= q.continuation) := by
  rw [Inv48.ActualSiteGuardJoin.dropAt _ 6 _ Inv48.RequestPrologue.actualQuoteBlock,
    Stmt.evalList]
  change ((Stmt.eval (n+3) _ q.context cut.start
    (.block (Inv48.RequestPrologue.quotePrefix ++
      Inv48.RequestQuote.quoteCaptureP.value :: [Inv48.QuoteTransport.aliasP.value])) >>=
    fun x => listNext (n+3) _ q.context (Inv48.RequestQuote.actual.drop 7) x) >>= cut.next) = _
  rw [blockSplit,cut.prefixTree]
  rw [cut.continuation]
  simp only [pureNext,assoc]

/-- Invert the retained source cut, rather than requesting a second suffix run. -/
theorem singleExecution {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (cut : Cut q n p a b) :
    ∃ result suffixTrace nextTrace,
      q.after = suffixTrace ++ nextTrace ∧
      Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table q.context
        cut.start (Inv48.RequestQuote.actual.drop 6)) suffixTrace (.ok result) ∧
      Interaction.Executes (cut.next result) nextTrace (.ok out) := by
  obtain ⟨result,st,nt,split,first,last⟩ := bindSuccess _ _ _ _ cut.execution
  exact ⟨result,st,nt,cut.quoteAfter.trans split,first,last⟩

/-- Both the quote body and its alias continuation are slices of the retained
source execution's own transcript, including the original outer continuation. -/
theorem sameTrace {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Site root Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (cut : Cut q n p a b)
    (bodyTrace afterTrace : Interaction.Transcript)
    (split : trace = q.before ++ bodyTrace ++ afterTrace) :
    cut.after = bodyTrace ++ afterTrace := by
  have eq := cut.split.symm.trans split
  rw [cut.quoteBefore] at eq
  exact List.append_cancel_left (by simpa only [List.append_assoc] using eq)
end Inv48.QuoteContinuationIdentity
