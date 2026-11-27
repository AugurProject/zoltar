import Inv48MinimumGuardSiteJoinSource
import Inv48ObservedMinimumGuardInterface
import Inv48FundingMinimumObservedFunding
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumGuardSiteJoin
open Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The retained quote supplies both the concrete body index and its execution. -/
structure Recovery (n : Nat) (c : Context) (physical : Runtime) (p a b : Nat)
    (trace : Interaction.Transcript) where
  post : Runtime
  cut : Inv48.MinimumFullTrace.QuoteRecovery (n+10) c physical p a b trace (.normal post)
  during : Interaction.Transcript
  value : Result
  before : Interaction.Transcript
  after : Interaction.Transcript
  split : trace = before ++ during ++ after
  ordinary : ¬ Escapes value
  bodyRun : Interaction.Executes (Stmt.eval (n+9) Inv48.Source.model.core.table
    {c with checked := true}
    (Inv48.Positive.start {Inv48.QuoteMinimumJoin.callSite
      (Inv48.WholeQuote.prepared physical p a b).pushScope p with locals := []} p)
    Inv48.Public.body) during (.ok value)
  body : Inv48.FundingMinimumObserved.Body (n+4) {c with checked := true}
    {Inv48.QuoteMinimumJoin.callSite (Inv48.WholeQuote.prepared physical p a b).pushScope p
      with locals := []} p during value

theorem fromQuote (n : Nat) (c : Context) (physical post : Runtime) (p a b : Nat)
    (hp : p<Inv32Division.R) (ha : a<Inv32Division.R) (hb : b<Inv32Division.R)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+15) Inv48.Source.model.core.table c
      (Inv48.WholeQuote.entry physical p a b) Inv48.WholeQuote.bodyP.value)
      trace (.ok (.normal post))) : Nonempty (Recovery n c physical p a b trace) := by
  obtain ⟨s⟩ := Inv48.MinimumFullTrace.quoteRecovery (n+10) c physical p a b hp ha hb
    trace (.normal post) (by simp [Escapes]) run
  obtain ⟨bt,value,before,after,split,ordinary,bodyRun⟩ := minimumBody n c _ s.minimumFinal p hp
    (by rfl) s.minimumTrace s.minimumRun
  obtain ⟨body⟩ := Inv48.FundingMinimumObserved.recoverBody (n+4) _ _ p bt value ordinary bodyRun
  exact ⟨⟨post,s,bt,value,before,after++s.quoteAfter,
    s.quoteSplit.trans ((congrArg (fun t => t++s.quoteAfter) split).trans
      (by simp only [List.append_assoc])),ordinary,bodyRun,body⟩⟩

/-- Restriction is derived from the containing quote, keeping the original rows. -/
theorem bodyMatches (s : Recovery n c physical p a b trace) (rows : ScriptedResponder)
    (aligned : Inv48.ChildExtraction.Matches rows trace) :
    Inv48.ChildExtraction.Matches rows s.during := by
  intro event member
  apply aligned event
  rw [s.split]
  exact List.mem_append_left _ (List.mem_append_right _ member)

#print axioms fromQuote
#print axioms bodyMatches
end Inv48.MinimumGuardSiteJoin
