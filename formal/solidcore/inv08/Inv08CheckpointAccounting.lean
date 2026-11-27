import Inv08CheckpointAccounts
open SolidCore.Solidity.Source
namespace Inv08.Checkpoint
open FundingHistory

/-- The stale branch pays the same released amount into isolated deferred balances. -/
theorem staleAccounts (H : Accounts s d fs paid) (sep : Separated fs.length) (now : Nat) (nf : now<2^48) :
    Accounts (staleState s now) d fs (nextPaid s paid now) := by
  by_cases a : stored s .through<now
  · simp only [staleState,activePaid s paid now a,if_pos a]
    exact afterDeferred (afterRelease H now nf a.le sep) sep _ _
  · simpa only [staleState,idlePaid s paid now a,if_neg a] using H
theorem staleBucket (H : Accounts s d fs paid) (b : Budgeted s) (now : Nat) (nf : now<2^48) (eth : Bool) :
    bucket (staleState s now) eth=bucket s eth+earned s now eth := by
  by_cases a : stored s .through<now
  · have room := bucketRoom b now (ready H now nf a.le)
    simp only [staleState,earned,if_pos a,bucket]
    rw [deferredStorage _ _ _ _ (room true) (room false),beforeDeferred]
    cases eth <;> rfl
  · simp [staleState,earned,a]
theorem staleClock (H : Accounts s d fs paid) (now : Nat) (nf : now<2^48) :
    stored (staleState s now) .through=max (stored s .through) now := by
  by_cases a : stored s .through<now
  · simp only [staleState,if_pos a,max_eq_right a.le]
    rw [outsideBuckets _ _ _ .through (by decide) (by decide)]
    exact (Release.clock s now nf (ready H now nf a.le).toReady.qFit).1
  · simp [staleState,a,max_eq_left (Nat.le_of_not_gt a)]
theorem paidAtStage (H : Accounts s d fs paid) (tm : Nat) (eth : Bool)
    (atStart : paid eth=vested d (stored s .through) fs eth) :
    nextPaid s paid tm eth=vested d (max (stored s .through) tm) fs eth := by
  by_cases a : stored s .through<tm
  · simpa only [nextPaid,earned,if_pos a,max_eq_right a.le] using lifetimeAfter H tm a.le eth
  · simpa only [nextPaid,earned,if_neg a,max_eq_left (Nat.le_of_not_gt a),Nat.add_zero] using atStart
def staleCredit (s : State) (tm now : Nat) (eth : Bool) := earned (eligibleState s tm) now eth
def totalPaid (s : State) (paid : Bool → Nat) (tm now : Nat) := nextPaid (eligibleState s tm) (nextPaid s paid tm) now
theorem finalAccounts (H : Accounts s d fs paid) (sep : Separated fs.length) (b : Budgeted s)
    (tm now : Nat) (nf : now<2^48) (permitted : tm≤now) :
    let last := finalState s tm now
    Accounts last d fs (totalPaid s paid tm now) ∧ Budgeted last ∧
      (∀ eth, bucket last eth=bucket s eth+staleCredit s tm now eth) ∧
      stored last .through=max (stored s .through) now := by
  have tf := lt_of_le_of_lt permitted nf
  have hs := stage H sep tm tf
  have bs := stageBound H b tm tf
  have hb (eth : Bool) := (staleBucket hs bs now nf eth).trans (congrArg (·+staleCredit s tm now eth) (stageBucket s tm eth))
  refine ⟨staleAccounts hs sep now nf,?_,hb,?_⟩
  · let mid := eligibleState s tm
    change Budgeted (staleState mid now)
    by_cases a : stored mid .through<now
    · intro eth
      have rr := ready hs now nf a.le
      have bu := staleBucket hs bs now nf eth
      change bucket (staleState mid now) eth=bucket mid eth+earned mid now eth at bu
      change stored (staleState mid now) (outstandingField eth)+bucket (staleState mid now) eth<2^128
      rw [bu]
      simp only [staleState,earned,if_pos a]
      rw [outsideBuckets _ _ _ (outstandingField eth) (by cases eth <;> decide) (by cases eth <;> decide),
        (Release.amounts mid now eth rr).2]
      change stored mid (outstandingField eth)-Preview.payout mid now eth+(bucket mid eth+Preview.payout mid now eth)<2^128
      rw [Nat.add_comm (bucket mid eth),←Nat.add_assoc,Nat.sub_add_cancel (rr.funded eth)]
      exact bs eth
    · simpa only [staleState,if_neg a] using bs
  · unfold finalState
    rw [staleClock hs now nf,stageClock H tm tf,Nat.max_assoc,max_eq_right permitted]
theorem totalAt (H : Accounts s d fs paid) (sep : Separated fs.length) (tm now : Nat)
    (nf : now<2^48) (allowed : tm≤now) (forward : stored s .through≤now)
    (atStart : ∀ eth, paid eth=vested d (stored s .through) fs eth) (eth : Bool) :
    totalPaid s paid tm now eth=vested d now fs eth := by
  have tf := lt_of_le_of_lt allowed nf
  have clk := stageClock H tm tf
  have mid : nextPaid s paid tm eth=vested d (stored (eligibleState s tm) .through) fs eth :=
    (paidAtStage H tm eth (atStart eth)).trans (congrArg (fun x => vested d x fs eth) clk.symm)
  have ans := paidAtStage (stage H sep tm tf) now eth mid
  simpa only [totalPaid,clk,Nat.max_assoc,max_eq_right allowed,max_eq_right forward] using ans
theorem cutoffAmount (H : Accounts s d fs paid) (start now cutoff : Nat) (forward : start≤now)
    (clock : stored s .through=start) (atStart : ∀ eth, paid eth=vested d start fs eth) (eth : Bool) :
    vested d (min start cutoff) fs eth + earned s (min now cutoff) eth = vested d (min now cutoff) fs eth := by
  by_cases active : start<min now cutoff
  · have lower : min start cutoff=start := Nat.min_eq_left (by omega)
    rw [lower,←atStart eth,earned,if_pos (clock ▸ active)]
    exact lifetimeAfter H (min now cutoff) (clock ▸ active.le) eth
  · have eq : min start cutoff=min now cutoff := by omega
    simp only [earned,clock,if_neg active,Nat.add_zero,eq]
end Inv08.Checkpoint
