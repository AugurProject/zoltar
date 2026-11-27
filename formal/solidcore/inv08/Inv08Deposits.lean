import Inv08ReachableCalls
import Inv08CheckpointFrequency
import Inv08FundingInputs
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory

theorem onCheckpoint (n : Nat) (c : Context) (v : ValidState s d fs) (auth : Authorized c s)
    (now tm : Nat) (clock : EnvWord.blockTimestamp.eval c=now) (sep : Separated fs.length) (nf : now<Packed.B)
    (allowed : tm≤now) (forward : stored s .through≤now)
    (returned : StateCall (n+79) "checkpoint" c s [.word tm]=some (.returned out outputs)) : ValidState out d fs := by
  have run := Checkpoint.call n c s tm now clock auth.fields auth.free auth.clone v.funded.accounts sep v.budget nf allowed
  obtain ⟨f,b,_⟩ := Checkpoint.fundedCheckpoint c s tm now v.funded sep v.budget nf allowed forward
  exact carryResult run returned ⟨f,b⟩

theorem cutoffTotals (fuel : Nat) (v : ValidState s d fs) (deposits : Groups d raw fs) (sep : Separated fs.length)
    (clock : stored s .through=start) (a : Checkpoint.Schedule cutoff s start xs stop)
    (b : Checkpoint.Schedule cutoff s start ys stop) :
    ∃ first last e p, Checkpoint.run fuel cutoff s xs=some (first,e,p) ∧ Checkpoint.run fuel cutoff s ys=some (last,e,p) ∧
      (∀ eth, Checkpoint.bucket first eth=Checkpoint.bucket last eth) ∧
      Checkpoint.Totals s first d raw start stop cutoff (fun eth => if eth then e else p) := by
  obtain ⟨first,last,e,p,one,two,buckets,T⟩ := Checkpoint.frequency fuel v.funded sep v.budget clock a b
  refine ⟨first,last,e,p,one,two,buckets,⟨fun eth => ?_,fun eth => ?_⟩⟩
  · simpa only [groupVested deposits] using T.eligible eth
  · simpa only [groupVested deposits] using T.combined eth

theorem expiredDeposits (fuel : Nat) (v : ValidState s d fs) (deposits : Groups d raw fs) (sep : Separated fs.length)
    (clock : stored s .through=start) (a : Checkpoint.Schedule cutoff s start xs stop)
    (ends : ∀ f∈raw,f.time+d≤stop) :
    ∃ last e p, Checkpoint.run fuel cutoff s xs=some (last,e,p) ∧ ∀ eth,
      Checkpoint.bucket last eth+(if eth then e else p)+vested d start raw eth=
        Checkpoint.bucket s eth+totalRate (streams eth raw) := by
  obtain ⟨last,e,p,run,_,_,_,T⟩ := Checkpoint.history fuel v.funded sep v.budget clock a
  refine ⟨last,e,p,run,fun eth => ?_⟩
  have total := T.combined eth
  simpa only [groupVested deposits,finalAmount _ _ _ _ v.funded.accounts.positive ends] using total
end Inv08.FundingHistory
