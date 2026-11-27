import Inv08CheckpointAccounting
open SolidCore.Solidity.Source
namespace Inv08.Checkpoint
open FundingHistory
theorem scalarStorage (s t : State) (same : t.storage=s.storage) (k : Field) : stored t k=stored s k :=
  scalarCongr t s k (by simp [State.loadSlot,same])
theorem call (n : Nat) (c : Context) (s : State) (tm now : Nat)
    (clock : EnvWord.blockTimestamp.eval c=now) (fields : c.storageFields=model.core.context.storageFields)
    (free : c.value=0) (clone : Authority.Clone c (Release.baseRuntime c s))
    (H : Accounts s d fs paid) (sep : Separated fs.length) (cap : Budgeted s) (nf : now<2^48) (allowed : tm≤now) :
    SolidCore.Solidity.TypeCheck.CheckedContract.callTargetWithContext? (n+79) model (.name "checkpoint") c s [.word tm] =
      some (.returned (output c s tm now) [.word (earned s tm true),.word (earned s tm false)]) := by
  have entry := transport s (Release.entryState c s) rfl H
  have ready := fromAccounts entry sep (budgetTransport _ _ rfl cap) tm now nf allowed
  subst now
  exact checkpoint n c s tm fields free clone ready

/-- Valid public checkpoints preserve funding accounts and the checked transfer budget.
The formula includes an eligibility deadline older than the previous checkpoint. -/
theorem publicEffects (c : Context) (s : State) (tm now : Nat)
    (H : Accounts s d fs paid) (sep : Separated fs.length) (cap : Budgeted s) (nf : now<2^48) (allowed : tm≤now) :
    let si := Release.entryState c s
    let last := output c s tm now
    Accounts last d fs (totalPaid si paid tm now) ∧ Budgeted last ∧
      (∀ eth, bucket last eth=bucket s eth+staleCredit si tm now eth) ∧
      stored last .through=max (stored s .through) now := by
  let si := Release.entryState c s
  let last := output c s tm now
  let expected := finalState si tm now
  have entry := transport s si rfl H
  obtain ⟨acc,bound,buckets,time⟩ := finalAccounts entry sep (budgetTransport s si rfl cap) tm now nf allowed
  have same : last.storage=expected.storage := outputFields c s tm now
  refine ⟨transport expected last same acc,budgetTransport expected last same bound,fun eth => ?_,?_⟩
  · exact (scalarStorage expected last same _).trans (buckets eth)
  · exact (scalarStorage expected last same _).trans time

theorem publicPaid (c : Context) (s : State) (tm now start : Nat)
    (H : Accounts s d fs paid) (sep : Separated fs.length) (nf : now<2^48)
    (allowed : tm≤now) (forward : start≤now) (clock : stored s .through=start)
    (atStart : ∀ eth, paid eth=vested d start fs eth) (eth : Bool) :
    totalPaid (Release.entryState c s) paid tm now eth = vested d now fs eth := by
  have entry := transport s (Release.entryState c s) rfl H
  exact totalAt entry sep tm now nf allowed (clock ▸ forward) (fun eth => (atStart eth).trans (congrArg (fun x => vested d x fs eth) clock.symm)) eth
end Inv08.Checkpoint
