import Inv48CollateralCloneFuelFacts
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneFuel
open Inv48.CollateralCloneStage Inv48.CollateralMinimum Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem bindings (s : Slice trace out) (d : Deployment s.context s.caller) :
    (Inv48.Minima.oracleData 2603245787 universeView).evalWithRuntimeByContext s.context s.start =
      .ok (.bytes (bytes d),s.start) ∧
    (Expr.immutable "securityPool").evalWithRuntimeByContext s.context s.start =
      .ok (.word d.root,s.start) := by
  have f := facts s d
  exact ⟨Inv48.Minima.oracleCalldata s.context s.start _ _ _ (by decide)
      (universe_bounds _ d.hu d.cu) f.sourceLocal,
    Inv48.Minima.immutableRead s.context s.start _ d.field d.root d.found
      (by rw [f.world]; exact d.stored) d.coercion⟩

/-- Replay the original successful read without changing its transcript or
final runtime. No minimum fuel assumption is imposed on the original run. -/
theorem closeSlice (s : Slice trace out) (d : Deployment s.context s.caller)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    ∃ response x rest,
      s.during = {query := (.external (snapshotWorld s.context s.start.state)
        (.call (buildCallRequest s.context .staticcall d.root (bytes d) 0 none))),answer := response} :: rest ∧
      response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x) := by
  have f := facts s d
  have b := bindings s d
  have run := replay (Nat.le_add_right s.n 2) _ _ _ _ _ _ s.read
  exact decodedRead s.n s.context s.start s.final s.during (decode d.universeBytes) d.root
    f.sourceLocal (universe_bounds _ d.hu d.cu) f.locals b.2 d.rootFit d.away env run

/-- Original recovered raw success and canonical deployment/oracle assumptions
suffice. Every continuation stays in the original recovered Slice, including
its original fuels, runtime snapshots and transcript concatenation. -/
theorem fromRecovered (fuel : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result)
    (h : Inv48.MinimumCollateralTrace.Recovered fuel c r trace out) :
    ∃ s : Slice trace out,
      ∀ (d : Deployment s.context s.caller),
        Facts s d ∧
        (Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during →
          ∃ response x, Inv48.MinimumSuccessWords.OracleEvent s.context s.start d.root (bytes d) s.during response ∧
            response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
            s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) := by
  obtain ⟨s⟩ := recover fuel c r trace out h
  refine ⟨s,?_⟩
  intro d
  refine ⟨facts s d,?_⟩
  intro env
  obtain ⟨response,x,rest,split,success,fit,decoded,captured⟩ := closeSlice s d env
  exact ⟨response,x,⟨rest,split⟩,success,fit,decoded,captured⟩

end Inv48.CollateralCloneFuel
