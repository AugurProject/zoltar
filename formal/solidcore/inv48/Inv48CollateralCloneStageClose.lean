import Inv48CollateralCloneStageDecoded
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneStage
open Inv48.CollateralMinimum Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem closeSlice (s : Slice trace out) (d : Deployment s.context s.caller)
    (enough : 46 ≤ s.n)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    ∃ response x rest,
      s.during = {query := (.external (snapshotWorld s.context s.start.state)
        (.call (buildCallRequest s.context .staticcall d.root (bytes d) 0 none))),answer := response} :: rest ∧
      response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
      s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x) := by
  have f := facts s d enough
  have b := bindings s d enough
  obtain ⟨n,eq⟩ := Nat.exists_eq_add_of_le' (show 2 ≤ s.n by omega)
  have run := s.read
  rw [eq] at run
  exact decodedRead n s.context s.start s.final s.during (decode d.universeBytes) d.root
    f.sourceLocal (universe_bounds _ d.hu d.cu) f.locals b.2 d.rootFit d.away env run

/-- The original transcript and all its continuations are carried by `Slice`.
Deployment is applied at its actual caller; the encoding facts are conclusions. -/
theorem fromRecovered (fuel : Nat) (c : Context) (r : Runtime)
    (trace : Interaction.Transcript) (out : Result)
    (h : Inv48.MinimumCollateralTrace.Recovered fuel c r trace out) :
    ∃ s : Slice trace out,
      ∀ (d : Deployment s.context s.caller), 46 ≤ s.n →
        Facts s d ∧
        (Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during →
          ∃ response x, Inv48.MinimumSuccessWords.OracleEvent s.context s.start d.root (bytes d) s.during response ∧
            response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
            s.final.lookupLocal? Inv03.Bodies.tmp = some (.word x)) := by
  obtain ⟨s⟩ := recover fuel c r trace out h
  refine ⟨s,?_⟩
  intro d enough
  refine ⟨facts s d enough,?_⟩
  intro env
  obtain ⟨response,x,rest,split,success,fit,decoded,captured⟩ := closeSlice s d enough env
  exact ⟨response,x,⟨rest,split⟩,success,fit,decoded,captured⟩
end Inv48.CollateralCloneStage
