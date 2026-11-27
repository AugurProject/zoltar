import Inv08FundAccounts
import Inv08FundBounds
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory

theorem afterFunding (H : Accounts s d xs paid) (h : Step d f xs ys) (sep : Separated ys.length)
    (now : f.time=stored s .through) (count : ys.length<2^48) (endFit : f.time+d<2^48)
    (budget : ∀ eth,stored s (outstandingField eth)+(stream eth f).budget<2^128) :
    Accounts (AddStream.post s f (record d xs)) d ys paid := by
  let p := record d xs
  have idEq : AddStream.nextId s f p=ys.length := stepId H.records H.duration h
  have fit := idEq.symm ▸ count
  have original := H.records.entries xs.length le_rfl
  rw [List.take_length,←H.records.count] at original
  have stages := AddStream.stages s f p _ sep idEq.le fit now.symm original
  obtain ⟨fits,cursorFits⟩ := fundingBounds H h now count endFit budget
  have records := preserveRecords h H.records H.duration sep stages fits
  obtain ⟨clock,duration,settled⟩ := AddStream.clockFields s f p _ sep idEq.le fit
  obtain ⟨past,sort⟩ := endOrder H h _ records now
  have settledRange : stored s .settled≤xs.length := H.settledRange.trans_eq H.records.count
  refine {
    records := records
    duration := duration.trans H.duration
    positive := H.positive
    through := ?_
    groupedCap := fun eth => groupedCapAfter H h eth now (budget eth)
    settledRange := ?_
    settledPast := ?_
    sorted := ?_
    cursor := ?_
    accounted := ?_
    earned := ?_ }
  · rw [clock,←now]; exact throughStep h (fun x hx => now.symm ▸ H.through x hx)
  · rw [settled,records.count]; exact settledRange.trans (countStep h)
  · rw [clock,settled,past _ settledRange]; exact H.settledPast
  · rwa [records.count]
  · intro eth
    rw [AddStream.cursorFields s f p eth (cursorFits eth),H.cursor,newBase h eth]
    exact Nat.add_right_comm _ _ _
  · intro eth
    rw [AddStream.debitFields s f p _ sep idEq.le eth (lt_trans (budget eth) (by decide)),newRate h eth,←H.accounted eth]
    exact Nat.add_right_comm _ _ _
  · intro eth
    rw [clock,←now,startingIntegral h eth,newBase h eth]
    have old := H.earned eth
    rw [←now] at old
    omega
end Inv08.FundingHistory
