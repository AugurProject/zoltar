import Inv48ActualSiteGuardJoinProof
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedQuoteJoin
open Inv48.ChildExtraction Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem matchesAppend (rows : ScriptedResponder) (xs ys : Interaction.Transcript) :
    Matches rows (xs ++ ys) ↔ Matches rows xs ∧ Matches rows ys := by
  constructor
  · intro h
    exact ⟨fun e he => h e (List.mem_append_left ys he),
      fun e he => h e (List.mem_append_right xs he)⟩
  · rintro ⟨hx,hy⟩ e he
    rcases List.mem_append.mp he with he | he
    · exact hx e he
    · exact hy e he

theorem matchesSplit (rows : ScriptedResponder) (trace before body after : Interaction.Transcript)
    (full : Matches rows trace) (split : trace = before ++ body ++ after) :
    Matches rows body ∧ Matches rows after := by
  rw [split] at full
  exact ⟨((matchesAppend rows _ _).mp ((matchesAppend rows _ _).mp full).1).2,
    ((matchesAppend rows _ _).mp full).2⟩

/-- Only full-trace alignment is an input. Neither slice alignment nor actual
result equality is assumed. The computed body must use exactly the site's fuel. -/
theorem observedBody {root : SolI Result} {trace : Interaction.Transcript} {out : Result}
    (q : Inv48.RequestClassify.Site root Inv48.Source.model.core.table
      Inv48.RequestQuote.quoteCaptureP.value trace out)
    (n p a b : Nat) (fn : InternalFunction) (rows : ScriptedResponder)
    (joined : Inv48.ActualSiteGuardJoin.Joined q n p a b fn)
    (full : Matches rows trace) (computed : Result)
    (evaluation : (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
      (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body).runWith rows = .ok computed) :
    ∃ bodyTrace afterTrace,
      trace = q.before ++ bodyTrace ++ afterTrace ∧
      Matches rows bodyTrace ∧ Matches rows afterTrace ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {q.context with checked := true}
        (Inv48.WholeQuote.entry (Inv48.RequestPrologue.base q.runtime) p a b) fn.body)
        bodyTrace (.ok computed) ∧
      Interaction.Executes ((internalCallFinish fn [Inv48.QuoteTransport.ret] q.runtime.locals computed >>=
        captureNext [Inv48.QuoteTransport.ret]) >>= q.continuation) afterTrace (.ok out) := by
  obtain ⟨_,_,_,_,actual,bt,aft,split,body,after⟩ := joined
  have aligned := matchesSplit rows trace q.before bt aft full split
  have eq := Inv48.PublicQuoteTransfer.observedResult _ rows bt actual computed aligned.1 body evaluation
  subst actual
  exact ⟨bt,aft,split,aligned.1,aligned.2,body,after⟩
end Inv48.ObservedQuoteJoin
