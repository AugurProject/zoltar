import Inv08Histories
open Inv08.FundingHistory
namespace Inv08

/-- INV-08. Any two schedules of the generated public checkpoint, with fixed funding,
eligibility cutoff and endpoints, return the same amounts and leave the same deferred balances.
Totals are measured against the individual successful public deposits since initialization. -/
theorem checkpointFrequency (fuel : Nat) (trace : Reachable n d s deposits buckets)
    (sep : Separated buckets.length) (clock : stored s .through=start)
    (first : Checkpoint.Schedule cutoff s start a stop) (second : Checkpoint.Schedule cutoff s start b stop) :
    ∃ x y eth rep, Checkpoint.run fuel cutoff s a=some (x,eth,rep) ∧ Checkpoint.run fuel cutoff s b=some (y,eth,rep) ∧
      (∀ token,Checkpoint.bucket x token=Checkpoint.bucket y token) ∧
      Checkpoint.Totals s x d deposits start stop cutoff (fun token => if token then eth else rep) := by
  obtain ⟨v,groups⟩ := represented trace
  exact cutoffTotals fuel v groups sep clock first second

/-- At the last expiry, both tokens' whole funded amounts have vested, including amounts already
paid before the interval and any portion allocated to the deferred balances during the interval. -/
theorem fullVesting (fuel : Nat) (trace : Reachable n d s deposits buckets)
    (sep : Separated buckets.length) (clock : stored s .through=start)
    (schedule : Checkpoint.Schedule cutoff s start calls stop) (ends : ∀ f∈deposits,f.time+d≤stop) :
    ∃ last e p, Checkpoint.run fuel cutoff s calls=some (last,e,p) ∧ ∀ eth,
      Checkpoint.bucket last eth+(if eth then e else p)+vested d start deposits eth=
        Checkpoint.bucket s eth+totalRate (streams eth deposits) := by
  obtain ⟨v,groups⟩ := represented trace
  exact expiredDeposits fuel v groups sep clock schedule ends

end Inv08

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for name in #[``Inv08.FundingHistory.startHistory,``Inv08.FundingHistory.appendDeposit,
    ``Inv08.checkpointFrequency,``Inv08.fullVesting] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-08 proof dependency {dep}"
