import Inv08HistoryBounds
import Inv08ReleaseState
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory

structure Accounts (s : State) (d : Nat) (fs : List Funding) (paid : Bool → Nat) : Prop where
  records : Records s d fs
  duration : stored s .duration = d
  positive : 0 < d
  through : ∀ f∈fs, f.time ≤ stored s .through
  groupedCap : ∀ eth f, f∈fs → (stream eth f).budget < 2^128
  settledRange : stored s .settled ≤ stored s .latest
  settledPast : stored s .settled=0 ∨ Expiry.endsAt s (stored s .settled)≤stored s .through
  sorted : ∀ i j, 0<i → i≤j → j≤stored s .latest → Expiry.endsAt s i≤Expiry.endsAt s j
  cursor : ∀ eth, stored s (cursorField eth) = baseline (streams eth fs) + paid eth*d
  accounted : ∀ eth, stored s (outstandingField eth) + paid eth = totalRate (streams eth fs)
  earned : ∀ eth, baseline (streams eth fs) + paid eth*d ≤ integral d (stored s .through) (streams eth fs)

theorem valueEq (H : Accounts s d fs paid) (tm : Nat) (forward : stored s .through ≤ tm) (eth : Bool) :
    Preview.value s tm eth = integral d tm (streams eth fs) := by
  have past := H.settledPast.imp_right (fun le => le_trans le forward)
  have cut := Expiry.selectedBoundary _ tm _ _ H.settledRange past (Expiry.latestFits s) H.sorted
  apply numerator H.records tm (Preview.q s tm) eth
  · rw [←H.records.count]; exact cut.2.1
  · rw [←H.records.count]; exact cut.2.2

theorem ready (H : Accounts s d fs paid) (tm : Nat) (time : tm<2^48) (forward : stored s .through ≤ tm) :
    Release.Ready s tm := by
  have cut := Expiry.selectedBoundary _ tm _ _ H.settledRange
    (H.settledPast.imp_right fun le => le_trans le forward) (Expiry.latestFits s) H.sorted
  have cursors (eth : Bool) : stored s (cursorField eth)≤Preview.value s tm eth := by
    rw [H.cursor,valueEq H tm forward]
    exact (H.earned eth).trans (monotone _ _ _ _ forward)
  refine {
    time := time
    forward := forward
    ordered := H.settledRange
    settled := H.settledPast.imp_right (fun le => le_trans le forward)
    sorted := H.sorted
    rateOrder := ?_
    fits := ?_
    cursors := cursors
    duration := H.duration.symm ▸ H.positive
    funded := ?_
    word := ?_ }
  · intro eth
    have max := (recordFields H.records fs.length le_rfl eth).2.1
    have idx : Preview.q s tm ≤ fs.length := H.records.count ▸ cut.2.1
    have low := (recordFields H.records _ idx eth).2.1
    rw [List.take_length] at max
    change Integral.rate s _ eth ≤ Integral.rate s _ eth
    rw [H.records.count,low,max]
    have pair : totalRate (streams eth fs) = totalRate (streams eth (fs.take (Preview.q s tm))) +
        totalRate (streams eth (fs.drop (Preview.q s tm))) := by
      simp only [totalRate,streams,←List.sum_append,←List.map_append,List.take_append_drop]
    rw [pair]; exact Nat.le_add_right _ _
  · intro eth
    rw [valueEq H tm forward]
    exact belowWord H.records eth tm time (H.groupedCap eth)
  · intro eth
    unfold Preview.payout
    rw [valueEq H tm forward,H.cursor,H.duration]
    have cap := maxVested d tm (streams eth fs)
    have total := H.accounted eth
    rw [←total,Nat.add_mul] at cap
    exact Nat.le_trans (Nat.div_le_div_right (by omega :
      integral d tm (streams eth fs) - (baseline (streams eth fs) + paid eth*d) ≤ stored s (outstandingField eth)*d))
      (by simp [H.positive])
  · intro eth
    have paidSum := H.accounted eth
    have count := Expiry.latestFits s
    rw [H.records.count] at count
    have rates := rateBound (streams eth fs) (by
      intro x hx
      obtain ⟨f,h,rfl⟩ := List.mem_map.mp hx
      exact H.groupedCap eth f h)
    simp only [streams,List.length_map] at rates
    have bound := Nat.mul_le_mul_right (2^128-1) (Nat.le_of_lt count)
    exact lt_of_le_of_lt (le_trans (H.accounted eth ▸ Nat.le_add_right (stored s (outstandingField eth)) (paid eth)) (le_trans rates bound)) (by decide)
end Inv08.FundingHistory
