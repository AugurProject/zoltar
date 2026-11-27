import Inv08HistoryIntegral
open Inv32Division
namespace Inv08.FundingHistory

theorem rateBound (xs : List Stream) (budget : ∀ x∈xs,x.budget < 2^128) :
    totalRate xs ≤ xs.length*(2^128-1) := by
  induction xs with
  | nil => simp [totalRate]
  | cons x xs ih =>
    have b := budget x (by simp)
    have tail := ih (fun a h => budget a (by simp [h]))
    change x.budget+totalRate xs ≤ (xs.length+1)*(2^128-1)
    rw [Nat.add_mul]; omega

theorem integralBound (d tm : Nat) (xs : List Stream) :
    integral d tm xs ≤ totalRate xs * tm := by
  induction xs with
  | nil => simp [integral,totalRate]
  | cons x xs ih =>
    change x.budget*min tm (x.fundedAt+d) + integral d tm xs ≤ (x.budget+totalRate xs)*tm
    rw [Nat.add_mul]
    exact Nat.add_le_add (Nat.mul_le_mul_left _ (Nat.min_le_left _ _)) ih

theorem belowWord (H : Records s d fs) (eth : Bool) (tm : Nat) (time : tm < 2^48)
    (budget : ∀ f∈fs, (stream eth f).budget < 2^128) : integral d tm (streams eth fs) < R := by
  have count := Expiry.latestFits s
  rw [H.count] at count
  have rates := rateBound (streams eth fs) (by
    intro x mem
    obtain ⟨f,h,rfl⟩ := List.mem_map.mp mem
    exact budget _ h)
  rw [show (streams eth fs).length = fs.length from List.length_map _] at rates
  have cap := Nat.mul_le_mul_right (2^128-1) (Nat.le_of_lt count)
  have bound := Nat.mul_le_mul (le_trans rates cap) (Nat.le_of_lt time)
  exact lt_of_le_of_lt ((integralBound _ _ _).trans bound) (by decide)

theorem maxVested (d tm : Nat) (xs : List Stream) :
    integral d tm xs ≤ baseline xs + totalRate xs*d := by
  induction xs with
  | nil => simp [integral,baseline,totalRate]
  | cons x xs ih =>
    change x.budget*min tm (x.fundedAt+d)+integral d tm xs ≤
      x.budget*x.fundedAt+baseline xs+(x.budget+totalRate xs)*d
    have le := Nat.mul_le_mul_left x.budget (Nat.min_le_right tm (x.fundedAt+d))
    rw [Nat.mul_add] at le
    rw [Nat.add_mul]
    omega
end Inv08.FundingHistory
