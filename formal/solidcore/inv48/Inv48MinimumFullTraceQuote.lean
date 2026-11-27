import Inv48MinimumFullTraceEntry
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
open Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Argument evaluation and the real getter collector/return are silent for
arbitrary values and runtimes. The original call and body traces are equal. -/
theorem quoteCallBody (s : QuoteRecovery n c physical price amount bounty trace out) :
    s.callTrace = s.bodyTrace := by
  have aq : Quiet (Expr.evalRefArgList s.site.context s.site.runtime [.var Inv32OneArg.argName]) :=
    (listQuiet _ _ _ _ (by decide)).2.1
  have an := quietEvents _ (quietCaught _ aq) s.argsRun
  have fn := quietEvents _ (finishQuiet _ _ _ _) s.finishRun
  rw [s.callSplit,an,fn,List.nil_append,List.append_nil]

/-- This path starts at the reached quote getter body. Both helpers are then
cut in order from this one path. -/
theorem quoteBodyRecovery (s : QuoteRecovery n c physical price amount bounty trace out) :
    Nonempty (BodyRecovery s.bodyFuel {s.site.context with checked := true} s.inner s.bodyTrace s.value) :=
  bodyRecovery _ _ _ _ _ s.ordinary s.bodyRun

theorem quotePair (s : QuoteRecovery n c physical price amount bounty trace out)
    (p : BodyRecovery s.bodyFuel {s.site.context with checked := true} s.inner s.bodyTrace s.value)
    (dC : Inv48.CollateralCloneStage.Deployment p.collateral.context p.collateral.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment p.collateral)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle p.collateral.context p.collateral.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) p.collateral.during)
    (dR : Inv48.RepReturnedMinimum.Deployment p.rep.context p.rep.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle p.rep.context p.rep.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) p.rep.during) :
    ∃ ac : Answer (collateralQuery p.collateral dC), ∃ ar : Answer (repQuery p.rep dR),
      s.bodyTrace = [{query := collateralQuery p.collateral dC,answer := ac},
        {query := repQuery p.rep dR,answer := ar}] ∧
      s.callTrace = s.bodyTrace ∧
      ∀ (escrowContext : Context) (state : State) (data : List Source.Byte),
        ∀ event ∈ s.callTrace, event.query ≠ Inv48.ObservedEscrowResponder.query escrowContext state data := by
  obtain ⟨ac,ar,pair⟩ := bodyPair p dC b envC dR envR
  refine ⟨ac,ar,pair,quoteCallBody s,?_⟩
  intro ec st data event member
  rw [quoteCallBody s] at member
  exact bodyExcludes p dC b envC dR envR ec st data event member

/-- Actual quote entry supplies the getter execution and the single dependent
path. The only remaining inputs describe deployments and canonical answers at
that path's own recovered suspensions; no event classification is assumed. -/
theorem quoteEntry (n : Nat) (c : Context) (physical : Runtime) (price amount bounty : Nat)
    (hp : price < Inv32Division.R) (ha : amount < Inv32Division.R) (hb : bounty < Inv32Division.R)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (Inv48.WholeQuote.entry physical price amount bounty) Inv48.WholeQuote.bodyP.value) trace (.ok out)) :
    ∃ s : QuoteRecovery n c physical price amount bounty trace out,
    ∃ p : BodyRecovery s.bodyFuel {s.site.context with checked := true} s.inner s.bodyTrace s.value,
      ∀ (dC : Inv48.CollateralCloneStage.Deployment p.collateral.context p.collateral.caller)
        (_b : Inv48.CollateralReturnedMinimum.BaseDeployment p.collateral)
        (_envC : Inv48.MinimumSuccessWords.CanonicalOracle p.collateral.context p.collateral.start dC.root
          (Inv48.CollateralCloneStage.bytes dC) p.collateral.during)
        (dR : Inv48.RepReturnedMinimum.Deployment p.rep.context p.rep.caller)
        (_envR : Inv48.MinimumSuccessWords.CanonicalOracle p.rep.context p.rep.start dR.root
          (Inv48.RepReturnedMinimum.bytes dR) p.rep.during),
      ∃ ac : Answer (collateralQuery p.collateral dC), ∃ ar : Answer (repQuery p.rep dR),
        s.bodyTrace = [{query := collateralQuery p.collateral dC,answer := ac},
          {query := repQuery p.rep dR,answer := ar}] ∧
        s.callTrace = s.bodyTrace ∧
        ∀ (escrowContext : Context) (state : State) (data : List Source.Byte),
          ∀ event ∈ s.callTrace, event.query ≠ Inv48.ObservedEscrowResponder.query escrowContext state data := by
  obtain ⟨s⟩ := quoteRecovery n c physical price amount bounty hp ha hb trace out ordinary run
  obtain ⟨p⟩ := quoteBodyRecovery s
  exact ⟨s,p,fun dC b envC dR envR => quotePair s p dC b envC dR envR⟩
end Inv48.MinimumFullTrace
