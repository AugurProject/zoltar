import Inv08FundingSlots
import Inv08HistoryIntegral
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory

inductive Step (d : Nat) (f : Funding) : List Funding → List Funding → Prop
  | append (xs : List Funding) (fresh : (record d xs).endAt ≠ f.time+d) : Step d f xs (xs++[f])
  | combine (xs : List Funding) (a : Funding) (same : a.time=f.time) : Step d f (xs++[a]) (xs++[merge a f])

theorem nextStep (d : Nat) (f : Funding) (xs : List Funding) (pos : 0<d) : ∃ ys,Step d f xs ys := by
  induction xs using List.reverseRecOn with
  | nil => exact ⟨_,Step.append [] (by change 0≠f.time+d; omega)⟩
  | append_singleton xs x _ =>
    by_cases equal : x.time=f.time
    · exact ⟨_,Step.combine xs x equal⟩
    · exact ⟨_,Step.append (xs++[x]) (by simp [record,equal])⟩

theorem stepEnd (h : Step d f xs ys) : record d ys = add d (record d xs) f := by
  cases h with
  | append xs _ => exact append d xs f
  | combine xs a same => exact sameSecond _ _ _ _ same

theorem stepPrefix (h : Step d f xs ys) (i : Nat) (prior : i<ys.length) : ys.take i = xs.take i ∧ i≤xs.length := by
  cases h with
  | append xs _ =>
    have le : i≤xs.length := by simp at prior; omega
    exact ⟨List.take_append_of_le_length le,le⟩
  | combine xs a _ =>
    have le : i≤xs.length := by simp at prior; omega
    simp [List.take_append_of_le_length le]; omega

theorem stepId (H : Records s d xs) (duration : stored s .duration=d) (h : Step d f xs ys) :
    AddStream.nextId s f (record d xs) = ys.length := by
  unfold AddStream.nextId
  rw [H.count,duration]
  cases h with
  | append xs fresh => simp [fresh]
  | combine xs a same => simp [record,same]

theorem preserveRecords (h : Step d f xs ys) (H : Records s d xs) (duration : stored s .duration=d)
    (sep : Separated ys.length) (stage : AddStream.StageReads s f (record d xs))
    (fits : ExpiryStorage.Fits (add d (record d xs) f)) :
    Records (AddStream.post s f (record d xs)) d ys := by
  have index := stepId H duration h
  have bound := Nat.le_of_eq index
  refine ⟨(AddStream.postId _ _ _ _ sep bound stage).trans index,?_⟩
  intro i le
  rcases Nat.eq_or_lt_of_le le with rfl | earlier
  · rw [List.take_length,←index,AddStream.postNew _ _ _ _ sep bound (duration.symm ▸ fits),duration,stepEnd h]
  · obtain ⟨matching,old⟩ := stepPrefix h i earlier
    rw [AddStream.postOld _ _ _ _ _ sep le bound (index.trans_ne earlier.ne.symm),matching,H.entries i old]
end Inv08.FundingHistory
