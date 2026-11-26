import Inv08Budgeted
import Inv08StorageTransport
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Checkpoint
open FundingHistory
def bucket (s : State) (eth : Bool) := stored s (deferredField eth)

theorem outsideBuckets (s : State) (e p : Nat) (k : Field) (three : 3≠k.slot) (four : 4≠k.slot) :
    stored (deferred s e p) k=stored s k := by
  change stored ((s.storeFieldWord Field.ethDeferred.field _).storeFieldWord Field.repDeferred.field _) k=stored s k
  rw [AddStream.otherField _ .repDeferred k _ four,AddStream.otherField _ .ethDeferred k _ three]
theorem afterDeferred (H : Accounts s d fs paid) (sep : Separated fs.length) (e p : Nat) :
    Accounts (deferred s e p) d fs paid := by
  let t := deferred s e p
  have field (k : Field) (h : 3≠k.slot) (j : 4≠k.slot) := outsideBuckets s e p k h j
  have dur := field .duration (by decide) (by decide)
  have th := field .through (by decide) (by decide)
  have ltst := field .latest (by decide) (by decide)
  have st := field .settled (by decide) (by decide)
  have cur (eth : Bool) := field (cursorField eth) (by cases eth <;> decide) (by cases eth <;> decide)
  have out (eth : Bool) := field (outstandingField eth) (by cases eth <;> decide) (by cases eth <;> decide)
  have records : Records t d fs := ⟨ltst.trans H.records.count,by
    intro i hi
    unfold t deferred deferAsset
    rw [beforeRecord _ _ _ hi sep,beforeRecord _ _ _ hi sep,H.records.entries i hi]⟩
  have endEq (i : Nat) (hi : i≤stored s .latest) : Expiry.endsAt t i=Expiry.endsAt s i := by
    rw [H.records.count] at hi
    exact (recordFields records i hi true).1.trans (recordFields H.records i hi true).1.symm
  refine ⟨records,dur.trans H.duration,H.positive,fun f m => (H.through f m).trans_eq th.symm,H.groupedCap,?_,?_,?_,?_,?_,?_⟩
  · rw [st,ltst]; exact H.settledRange
  · change stored (deferred s e p) .settled=0 ∨ Expiry.endsAt t (stored (deferred s e p) .settled)≤_
    rw [st,endEq _ H.settledRange,th]; exact H.settledPast
  · intro i j pos le bound
    rw [ltst] at bound
    change Expiry.endsAt t i≤Expiry.endsAt t j
    rw [endEq _ (le_trans le bound),endEq _ bound]
    exact H.sorted _ _ pos le bound
  · intro eth; rw [cur,H.cursor]
  · intro eth; rw [out,H.accounted]
  · intro eth; rw [th]; exact H.earned eth
theorem bucketRoom (b : Budgeted s) (now : Nat) (rdy : Release.Ready s now) : BucketsFit s now := by
  intro eth
  rw [beforeDeferred]
  have safe := b eth
  have avail := rdy.funded eth
  exact lt_of_le_of_lt ((Nat.add_le_add_left avail _).trans_eq (Nat.add_comm ..)) (lt_trans safe (by decide))
def nextPaid (s : State) (paid : Bool → Nat) (tm : Nat) := fun eth => paid eth+earned s tm eth
theorem activePaid (s : State) (paid : Bool → Nat) (tm : Nat) (a : stored s .through<tm) :
    nextPaid s paid tm=fun eth => paid eth+Preview.payout s tm eth := by
  funext eth; simp only [nextPaid,earned,if_pos a]
theorem idlePaid (s : State) (paid : Bool → Nat) (tm : Nat) (a : ¬stored s .through<tm) :
    nextPaid s paid tm=paid := by
  funext eth; simp only [nextPaid,earned,if_neg a,Nat.add_zero]
theorem stage (H : Accounts s d fs paid) (sep : Separated fs.length) (tm : Nat) (tf : tm<2^48) :
    Accounts (eligibleState s tm) d fs (nextPaid s paid tm) := by
  by_cases active : stored s .through<tm
  · simpa only [eligibleState,activePaid s paid tm active,if_pos active] using afterRelease H tm tf (Nat.le_of_lt active) sep
  · simpa only [eligibleState,idlePaid s paid tm active,if_neg active] using H
theorem stageClock (H : Accounts s d fs paid) (tm : Nat) (tf : tm<2^48) :
    stored (eligibleState s tm) .through=max (stored s .through) tm := by
  by_cases a : stored s .through<tm
  · simp only [eligibleState,if_pos a,max_eq_right (Nat.le_of_lt a)]
    exact (Release.clock s tm tf (ready H tm tf (Nat.le_of_lt a)).toReady.qFit).1
  · simp only [eligibleState,if_neg a,max_eq_left (Nat.le_of_not_gt a)]
theorem stageBucket (s : State) (tm : Nat) (eth : Bool) :
    bucket (eligibleState s tm) eth=bucket s eth := by
  unfold eligibleState bucket
  split
  · exact beforeDeferred _ _ _
  · rfl
theorem stageBound (H : Accounts s d fs paid) (b : Budgeted s) (tm : Nat) (tf : tm<2^48) :
    Budgeted (eligibleState s tm) := by
  by_cases active : stored s .through<tm
  · simpa only [eligibleState,if_pos active] using releaseBudget s tm (ready H tm tf active.le) b
  · simpa only [eligibleState,if_neg active] using b
theorem fromAccounts (H : Accounts s d fs paid) (sep : Separated fs.length) (b : Budgeted s)
    (tm now : Nat) (nf : now<2^48) (allowed : tm≤now) : Ready s tm now := by
  have tf := lt_of_le_of_lt allowed nf
  have mid := stage H sep tm tf
  refine ⟨tf,allowed,H.duration.symm ▸ H.positive,fun f => ready H tm tf f.le,fun f => ready mid now nf f.le,?_⟩
  exact fun f => bucketRoom (stageBound H b tm tf) now (ready mid now nf f.le)
end Inv08.Checkpoint
