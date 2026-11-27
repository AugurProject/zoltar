import Inv08PreserveRelease
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory

theorem transport (s t : State) (same : t.storage=s.storage) (H : Accounts s d fs paid) :
    Accounts t d fs paid := by
  have slot (i : Nat) : t.loadSlot i=s.loadSlot i := by simp [State.loadSlot,same]
  have field (k : Field) := scalarCongr t s k (slot k.slot)
  have endAt (i : Nat) : Expiry.endsAt t i = Expiry.endsAt s i := by
    unfold Expiry.endsAt ExpiryStorage.memberWord
    rw [slot]
  have records : Records t d fs := ⟨(field _).trans H.records.count,fun i h =>
    (tupleCongr t s _ (fun _ => slot _)).trans (H.records.entries i h)⟩
  refine {
    records := records
    duration := (field _).trans H.duration
    positive := H.positive
    groupedCap := H.groupedCap
    through := ?_
    settledRange := ?_
    settledPast := ?_
    sorted := ?_
    cursor := fun eth => (field _).trans (H.cursor eth)
    accounted := ?_
    earned := ?_ }
  all_goals simp only [field,endAt]
  · exact H.through
  · exact H.settledRange
  · exact H.settledPast
  · exact H.sorted
  · exact H.accounted
  · exact H.earned

end Inv08.FundingHistory
