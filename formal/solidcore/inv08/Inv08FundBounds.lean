import Inv08FundTimes
open Inv32Division
namespace Inv08.FundingHistory
theorem weightedBound (d : Nat) (ss : List Stream) (endBound : ∀ x∈ss,x.fundedAt+d≤2^48) :
    weightedEnds d ss ≤ totalRate ss * 2^48 := by
  induction ss with
  | nil => simp [weightedEnds,totalRate]
  | cons x xs ih =>
    change x.budget*(x.fundedAt+d)+weightedEnds d xs ≤ (x.budget+totalRate xs)*2^48
    rw [Nat.add_mul]
    exact Nat.add_le_add (Nat.mul_le_mul_left _ (endBound _ (by simp))) (ih (fun y hy => endBound _ (by simp [hy])))

theorem fundingBounds (H : Accounts s d xs paid) (h : Step d f xs ys)
    (atTime : f.time=stored s .through) (count : ys.length<2^48) (endFit : f.time+d<2^48)
    (budget : ∀ eth,stored s (outstandingField eth)+(stream eth f).budget<2^128) :
    ExpiryStorage.Fits (add d (record d xs) f) ∧
    ∀ eth,stored s (cursorField eth)+(stream eth f).budget*f.time<R := by
  have rates (eth : Bool) : totalRate (streams eth ys) ≤ 2^48*(2^128-1) := by
    apply le_trans (rateBound _ ?_)
    · simp only [streams,List.length_map]
      exact Nat.mul_le_mul_right _ (Nat.le_of_lt count)
    · intro x hx
      obtain ⟨a,ha,rfl⟩ := List.mem_map.mp hx
      exact groupedCapAfter H h eth atTime (budget eth) a ha
  have ends (eth : Bool) : ∀ x∈streams eth ys,x.fundedAt+d≤2^48 := by
    intro x hx
    obtain ⟨a,ha,rfl⟩ := List.mem_map.mp hx
    exact (Nat.add_le_add_right (throughStep h (fun v hv => atTime.symm ▸ H.through v hv) a ha) _).trans endFit.le
  have weighted (eth : Bool) : weightedEnds d (streams eth ys)<R :=
    lt_of_le_of_lt ((weightedBound _ _ (ends eth)).trans (Nat.mul_le_mul_right _ (rates eth))) (by decide)
  constructor
  · rw [←stepEnd h]
    refine ⟨?_,lt_of_le_of_lt (rates true) (by decide),lt_of_le_of_lt (rates false) (by decide),weighted true,weighted false⟩
    rw [stepEnd h]; exact endFit
  · intro eth
    have earned := H.earned eth
    rw [←atTime] at earned
    have total := (integralBound d f.time (streams eth ys)).trans
      (Nat.mul_le_mul (rates eth) (le_trans (Nat.le_add_right _ _) endFit.le))
    have fit : integral d f.time (streams eth ys) < R := lt_of_le_of_lt total (by decide)
    rw [startingIntegral h eth] at fit
    rw [H.cursor]
    exact lt_of_le_of_lt (Nat.add_le_add_right earned _) fit
end Inv08.FundingHistory
