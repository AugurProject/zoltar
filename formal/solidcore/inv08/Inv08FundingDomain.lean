import Inv08FundingCount
import Inv08AddStreamGuards
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory

def deferredField (eth : Bool) : Field := if eth then .ethDeferred else .repDeferred

theorem fundingDomain (H : Accounts s d xs paid) (h : Step d f xs ys) (bound : CountBound xs)
    (now : stored s .through=f.time) (ends : f.time+d<2^48) (nonzero : f.eth≠0 ∨ f.rep≠0)
    (budget : ∀ eth,stored s (outstandingField eth)+(stream eth f).budget+stored s (deferredField eth)<2^128)
    (sep : Separated ys.length) : AddStream.Domain s f (record d xs) ∧ AddStream.StageReads s f (record d xs) ∧
      (record d xs).endAt<2^48 ∧ CountBound ys ∧ ys.length<2^48 := by
  have past (a) (ha : a∈xs) := (H.through a ha).trans_eq now
  obtain ⟨nextCount,length⟩ := countAfter h bound past
  have cnt := lt_of_le_of_lt (length.trans (Nat.add_le_add_left H.positive f.time)) ends
  have oldBound (eth : Bool) := lt_of_le_of_lt (Nat.le_add_right _ _) (budget eth)
  obtain ⟨fits,cur⟩ := fundingBounds H h now.symm cnt ends oldBound
  have eid := stepId H.records H.duration h
  have orig := H.records.entries xs.length le_rfl
  rw [List.take_length,←H.records.count] at orig
  have idfit := lt_of_eq_of_lt eid cnt
  have stage := AddStream.stages s f _ ys.length sep eid.le idfit now orig
  have ef : stored s .ethOut+f.eth<R := lt_trans (oldBound true) (by decide)
  have rf : stored s .repOut+f.rep<R := lt_trans (oldBound false) (by decide)
  have ep : stored (AddStream.withOutstanding s f) .ethOut = stored s .ethOut+f.eth := by
    unfold AddStream.withOutstanding AddStream.withEth
    rw [AddStream.otherField _ .repOut .ethOut _ (by decide)]
    exact Release.readWritten _ .ethOut _ rfl rfl ef
  have rp : stored (AddStream.withOutstanding s f) .repOut = stored s .repOut+f.rep :=
    Release.readWritten _ .repOut _ rfl rfl rf
  have eb := AddStream.olderScalar s f .ethDeferred (by decide) (by decide)
  have rb := AddStream.olderScalar s f .repDeferred (by decide) (by decide)
  change (AddStream.withOutstanding s f).loadSlot 3=stored s .ethDeferred at eb
  change (AddStream.withOutstanding s f).loadSlot 4=stored s .repDeferred at rb
  refine ⟨⟨now,H.duration.symm ▸ H.positive,H.duration.symm ▸ ends,nonzero,ef,rf,?_,?_,idfit,H.duration.symm ▸ fits,cur true,cur false⟩,
    stage,?_,nextCount,cnt⟩
  · rw [ep,eb]; exact budget true
  · rw [rp,rb]; exact budget false
  · cases xs using List.reverseRecOn with
    | nil => exact Nat.two_pow_pos 48
    | append_singleton pre a =>
      have le := past a (by simp)
      simpa [record] using (lt_of_le_of_lt (Nat.add_le_add_right le d) ends)

end Inv08.FundingHistory
