import Inv48QuoteSegmentEventsObserved
import Inv48QuoteEntryTailCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteSegmentEvents
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Actual successful collateral arithmetic contributes no further events.
Overflow safety and returned values are recovered from this very execution. -/
theorem collateralTailEvents (n : Nat) (c : Context) (r final : Runtime)
    (x base : Nat) (values : List Value) (trace : Interaction.Transcript)
    (small : x<Inv32Division.R) (bsmall : base<Inv32Division.R) (checked : c.checked=true)
    (X : r.lookupLocal? Inv03.Bodies.tmp=some (.word x))
    (B : r.lookupLocal? Inv48.Minima.operand=some (.word base))
    (run : Interaction.Executes (Stmt.evalList (n+16) Inv48.Source.model.core.table c r
      Inv48.Minima.collateralTail) trace (.ok (.returned final values))) :
    trace = [] ∧ base+Inv03.ceilQuot x 100<Inv32Division.R ∧
      values = [.word (base+Inv03.ceilQuot x 100)] := by
  obtain ⟨fit,valuesEq,finalEq,nilTrace⟩ :=
    Inv48.MinimumSuccessWords.collateralTailRecovered n c r final x base values trace
      small bsmall checked X B run
  exact ⟨nilTrace,fit,valuesEq⟩

/-- The REP arithmetic tail is silent for its retained successful execution. -/
theorem repTailEvents (n : Nat) (c : Context) (r final : Runtime)
    (x : Nat) (values : List Value) (trace : Interaction.Transcript)
    (small : x<Inv32Division.R)
    (X : r.lookupLocal? Inv03.Bodies.tmp=some (.word x))
    (run : Interaction.Executes (Stmt.evalList (n+16) Inv48.Source.model.core.table c r
      Inv48.Minima.repTail) trace (.ok (.returned final values))) :
    trace = [] ∧ values = [.word (Inv03.ceilQuot x 100)] := by
  obtain ⟨fit,valuesEq,nilTrace⟩ :=
    Inv48.MinimumSuccessWords.repTailRecovered n c r final x values trace small X run
  exact ⟨nilTrace,valuesEq⟩

/-- Concatenation preserves the exact retained event order. -/
theorem consecutive (before body after : Interaction.Transcript)
    (left : before = []) (right : after = []) :
    before ++ body ++ after = body := by
  rw [left,right,List.nil_append,List.append_nil]

/-- Pure generated funding is event-free on the retained runtime immediately
after the quote allocation. No successful alternate quote is assumed. -/
theorem fundingEvents (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R)
    (fits : Inv48.QuoteExec.repAmount a p<Inv32Division.R)
    (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.evalList (n+20) Inv48.Source.model.core.table c
      (Inv48.QuoteEntryTail.start physical p a bounty)
      ((Inv48.QuoteMemory.actualStatements.drop 1).take 4)) trace (.ok out)) :
    trace = [] ∧ out = .normal (Inv48.QuoteEntryTail.funded physical p a bounty) := by
  rw [Inv48.QuoteEntryTail.fundingExecution n c physical p a bounty hp ha fits] at run
  cases run
  exact ⟨rfl,rfl⟩
end Inv48.QuoteSegmentEvents
