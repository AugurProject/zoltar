import Inv08FundMath
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory

theorem countStep (h : Step d f xs ys) : xs.length≤ys.length := by
  cases h <;> simp

theorem throughStep (h : Step d f xs ys) (past : ∀ x∈xs,x.time≤f.time) : ∀ x∈ys,x.time≤f.time := by
  cases h with
  | append xs _ =>
    intro x m
    rcases List.mem_append.mp m with earlier | current
    · exact past x earlier
    · simpa [List.mem_singleton.mp current]
  | combine xs a same =>
    intro x m
    rcases List.mem_append.mp m with earlier | current
    · exact past x (List.mem_append_left _ earlier)
    · rw [List.mem_singleton.mp current]; exact same.le

theorem oldEnd (h : Step d f xs ys) (i : Nat) (known : i≤xs.length) :
    (record d (ys.take i)).endAt=(record d (xs.take i)).endAt := by
  cases h with
  | append xs _ => rw [List.take_append_of_le_length known]
  | combine xs a same =>
    by_cases old : i≤xs.length
    · rw [List.take_append_of_le_length old,List.take_append_of_le_length old]
    · have e : i=xs.length+1 := by simp at known; omega
      subst i
      rw [List.take_of_length_le (by simp : (xs++[merge a f]).length ≤ xs.length+1),List.take_of_length_le (by simp : (xs++[a]).length ≤ xs.length+1)]
      simp [record,merge]

theorem endOrder (H : Accounts s d xs paid) (h : Step d f xs ys) (post : State) (new : Records post d ys)
    (atTime : f.time=stored s .through) :
    (∀ i, i≤xs.length → Expiry.endsAt post i=Expiry.endsAt s i) ∧
    ∀ i j, 0<i → i≤j → j≤ys.length → Expiry.endsAt post i≤Expiry.endsAt post j := by
  have keep (i : Nat) (le : i≤xs.length) :=
    ((recordFields new i (le.trans (countStep h)) true).1.trans (oldEnd h i le)).trans (recordFields H.records i le true).1.symm
  refine ⟨keep,?_⟩
  intro i j positive le bound
  by_cases prior : j≤xs.length
  · rw [keep _ prior,keep _ (le.trans prior)]
    exact H.sorted _ _ positive le (H.records.count.symm ▸ prior)
  · have last : j=ys.length := by cases h <;> simp at * <;> omega
    subst j
    have endMax : Expiry.endsAt post ys.length=f.time+d := by
      rw [(recordFields new _ le_rfl true).1,List.take_length,stepEnd h]; rfl
    rw [endMax]
    cases i with
    | zero => omega
    | succ k =>
      have kb : k<ys.length := le
      rw [endAt new k kb]
      exact Nat.add_le_add_right (throughStep h (fun x hx => atTime.symm ▸ H.through x hx) _ (List.getElem_mem kb)) _
end Inv08.FundingHistory
