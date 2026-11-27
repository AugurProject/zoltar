import Inv08FundingStep
import Inv08HistoryReady
namespace Inv08.FundingHistory
theorem newRate (h : Step d f xs ys) (eth : Bool) :
    totalRate (streams eth ys) = totalRate (streams eth xs)+(stream eth f).budget := by
  have e := stepEnd h
  cases eth
  · exact congrArg ExpiryStorage.Record.repRate e
  · exact congrArg ExpiryStorage.Record.ethRate e

theorem newBase (h : Step d f xs ys) (eth : Bool) :
    baseline (streams eth ys) = baseline (streams eth xs)+(stream eth f).budget*f.time := by
  cases h with
  | append xs _ => exact addBaseline _ _ _
  | combine xs a same =>
    rw [mergeBaseline xs eth a f same]
    simpa [List.append_assoc] using addBaseline (xs++[a]) eth f

theorem startingIntegral (h : Step d f xs ys) (eth : Bool) :
    integral d f.time (streams eth ys) = integral d f.time (streams eth xs)+(stream eth f).budget*f.time := by
  cases h with
  | append xs _ => simp [integral,streams,stream,List.sum_append]
  | combine xs a same =>
    cases eth <;> simp [integral,streams,stream,merge,same,List.sum_append,Nat.add_assoc,Nat.add_mul]

theorem currentBucketUnspent (H : Accounts s d (xs++[a]) paid) (eth : Bool) (atTime : a.time=stored s .through) :
    (stream eth a).budget ≤ stored s (outstandingField eth) := by
  have prior := H.earned eth
  have accounts := H.accounted eth
  rw [←atTime,addBaseline] at prior
  have lastIntegral : integral d a.time (streams eth (xs++[a])) =
    integral d a.time (streams eth xs)+(stream eth a).budget*a.time := by
    simp [integral,streams,stream,List.sum_append]
  rw [lastIntegral] at prior
  have total : totalRate (streams eth (xs++[a])) = totalRate (streams eth xs)+(stream eth a).budget := by
    simp [totalRate,streams,List.sum_append]
  rw [total] at accounts
  have past := maxVested d a.time (streams eth xs)
  have mul : paid eth*d ≤ totalRate (streams eth xs)*d := by omega
  have allowed := Nat.le_of_mul_le_mul_right mul H.positive
  apply Nat.le_of_add_le_add_right (b:=paid eth)
  rw [accounts,Nat.add_comm (totalRate (streams eth xs))]
  exact Nat.add_le_add_left allowed _

theorem groupedCapAfter (H : Accounts s d xs paid) (h : Step d f xs ys) (eth : Bool)
    (atTime : f.time=stored s .through) (cap : stored s (outstandingField eth)+(stream eth f).budget < 2^128) :
    ∀ a∈ys,(stream eth a).budget < 2^128 := by
  cases h with
  | append xs fresh =>
    intro a m
    simp only [List.mem_append,List.mem_singleton] at m
    rcases m with earlier | rfl
    · exact H.groupedCap eth _ earlier
    · exact lt_of_le_of_lt (Nat.le_add_left _ _) cap
  | combine xs a same =>
    intro b m
    simp only [List.mem_append,List.mem_singleton] at m
    rcases m with earlier | rfl
    · exact H.groupedCap eth _ (List.mem_append_left _ earlier)
    · have enough := currentBucketUnspent H eth (same.trans atTime)
      have combined : (stream eth (merge a f)).budget = (stream eth a).budget + (stream eth f).budget := by cases eth <;> rfl
      rw [combined]
      exact lt_of_le_of_lt (Nat.add_le_add_right enough _) cap

end Inv08.FundingHistory
