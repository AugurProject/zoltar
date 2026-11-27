import Inv08FundingCount
namespace Inv08.FundingHistory

/-- Relates the actual deposits, including duplicates, to Solidity's cumulative expiry buckets. -/
inductive Groups (d : Nat) : List Funding → List Funding → Prop
  | nil : Groups d [] []
  | fund : Groups d raw xs → Step d f xs ys → Groups d (raw++[f]) ys

theorem integralStep (h : Step d f xs ys) (tm : Nat) (eth : Bool) :
    integral d tm (streams eth ys)=integral d tm (streams eth xs)+(stream eth f).budget*min tm (f.time+d) := by
  cases h with
  | append xs _ => simp [integral,streams,stream,List.sum_append]
  | combine xs a same =>
    cases eth <;> simp [integral,streams,stream,merge,same,List.sum_append,Nat.add_assoc,Nat.add_mul]

theorem groupValues (g : Groups d raw xs) (eth : Bool) (tm : Nat) :
    totalRate (streams eth xs)=totalRate (streams eth raw) ∧ baseline (streams eth xs)=baseline (streams eth raw) ∧
      integral d tm (streams eth xs)=integral d tm (streams eth raw) := by
  induction g with
  | nil => exact ⟨rfl,rfl,rfl⟩
  | fund g h ih =>
    rw [newRate h eth,newBase h eth,integralStep h tm eth,ih.1,ih.2.1,ih.2.2]
    simp [totalRate,baseline,integral,streams,List.sum_append,stream]

theorem groupVested (g : Groups d raw xs) (tm : Nat) (eth : Bool) :
    vested d tm xs eth=vested d tm raw eth := by
  obtain ⟨_,base,int⟩ := groupValues g eth tm
  rw [vested,vested,int,base]

end Inv08.FundingHistory
