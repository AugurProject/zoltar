import Inv08PreserveFunding
import Inv08Cumulative

namespace Inv08.FundingHistory

/-- Each distinct expiry consumes one ID, even when several deposits arrive in one second. -/
def CountBound (fs : List Funding) : Prop :=
  fs.length ≤ (fs.getLast?.map (fun a => a.time+1)).getD 0

theorem countAfter (h : Step d f xs ys) (bound : CountBound xs)
    (past : ∀ a ∈ xs, a.time ≤ f.time) : CountBound ys ∧ ys.length ≤ f.time+1 := by
  cases h with
  | append xs fresh =>
    have le : xs.length ≤ f.time := by
      cases xs using List.reverseRecOn with
      | nil => simp
      | append_singleton pre a =>
        have earlier := past a (by simp)
        have diff : a.time ≠ f.time := by
          intro e
          exact fresh (by simp [record,e])
        simp [CountBound] at bound
        simp
        omega
    simpa [CountBound] using le
  | combine xs a same =>
    simp [CountBound] at bound
    simp [CountBound,merge,same] at *
    omega

theorem vestedAtFunding (h : Step d f xs ys) (eth : Bool) :
    vested d f.time ys eth = vested d f.time xs eth := by
  simp only [vested,startingIntegral h eth,newBase h eth,Nat.add_sub_add_right]

end Inv08.FundingHistory
