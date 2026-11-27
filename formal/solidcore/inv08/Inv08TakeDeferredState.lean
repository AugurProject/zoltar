import Inv08FundingStages
import Inv08StorageTransport
import Inv08CheckpointDeferred
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.TakeDeferred
open FundingHistory
def replaceBuckets (s : State) (eth rep : Nat) :=
  (s.storeFieldWord Field.ethDeferred.field eth).storeFieldWord Field.repDeferred.field rep
def post (s : State) := replaceBuckets s 0 0

theorem unchanged (s : State) (eth rep : Nat) (k : Field) (three : 3≠k.slot) (four : 4≠k.slot) :
    stored (replaceBuckets s eth rep) k=stored s k := by
  unfold replaceBuckets
  rw [AddStream.otherField _ .repDeferred k _ four,AddStream.otherField _ .ethDeferred k _ three]

theorem cleared (s : State) (eth : Bool) : stored (post s) (Checkpoint.deferredField eth)=0 := by
  cases eth
  · change ((s.storeSlot 3 0).storeSlot 4 0).loadSlot 4=0
    rw [slotAfter,if_pos rfl]; rfl
  · change ((s.storeSlot 3 0).storeSlot 4 0).loadSlot 3=0
    rw [slotAfter,if_neg (by decide),slotAfter,if_pos rfl]; rfl

theorem outside (s : State) (eth : Bool) : stored (post s) (outstandingField eth)=stored s (outstandingField eth) :=
  unchanged _ _ _ _ (by cases eth <;> decide) (by cases eth <;> decide)

theorem clock (s : State) : stored (post s) .through=stored s .through := unchanged _ _ _ _ (by decide) (by decide)
theorem count (s : State) : stored (post s) .latest=stored s .latest := unchanged _ _ _ _ (by decide) (by decide)

/-- Replacing only the two deferred balances preserves the entire represented funding history. -/
theorem preserve (H : Accounts s d fs paid) (sep : Separated fs.length) (e p : Nat) :
    Accounts (replaceBuckets s e p) d fs paid := by
  let t := replaceBuckets s e p
  have field (k : Field) (h : 3≠k.slot) (j : 4≠k.slot) := unchanged s e p k h j
  have dur := field .duration (by decide) (by decide)
  have th := field .through (by decide) (by decide)
  have ltst := field .latest (by decide) (by decide)
  have st := field .settled (by decide) (by decide)
  have cur (eth : Bool) := field (cursorField eth) (by cases eth <;> decide) (by cases eth <;> decide)
  have out (eth : Bool) := field (outstandingField eth) (by cases eth <;> decide) (by cases eth <;> decide)
  have records : Records t d fs := ⟨ltst.trans H.records.count,by
    intro i hi
    unfold t replaceBuckets
    rw [beforeRecord _ _ _ hi sep,beforeRecord _ _ _ hi sep,H.records.entries i hi]⟩
  have endEq (i : Nat) (hi : i≤stored s .latest) : Expiry.endsAt t i=Expiry.endsAt s i := by
    rw [H.records.count] at hi
    exact (recordFields records i hi true).1.trans (recordFields H.records i hi true).1.symm
  refine ⟨records,dur.trans H.duration,H.positive,fun f m => (H.through f m).trans_eq th.symm,H.groupedCap,?_,?_,?_,?_,?_,?_⟩
  · rw [st,ltst]; exact H.settledRange
  · change stored (replaceBuckets s e p) .settled=0 ∨ Expiry.endsAt t (stored (replaceBuckets s e p) .settled)≤_
    rw [st,endEq _ H.settledRange,th]; exact H.settledPast
  · intro i j pos le bound
    rw [ltst] at bound
    change Expiry.endsAt t i≤Expiry.endsAt t j
    rw [endEq _ (le_trans le bound),endEq _ bound]
    exact H.sorted _ _ pos le bound
  · intro eth; rw [cur,H.cursor]
  · intro eth; rw [out,H.accounted]
  · intro eth; rw [th]; exact H.earned eth
end Inv08.TakeDeferred
