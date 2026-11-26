import Inv08PostAmounts
import Inv08Cumulative
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory
theorem afterRelease (H : Accounts s d fs paid) (tm : Nat) (time : tm<Packed.B) (forward : stored s .through ≤ tm)
    (sep : Separated fs.length) :
    Accounts (Release.post s tm) d fs (fun eth => paid eth + Preview.payout s tm eth) := by
  have run := ready H tm time forward
  have qf := run.toReady.qFit
  obtain ⟨through,latest,settled,duration⟩ := Release.clock s tm time qf
  have cut := Expiry.selectedBoundary _ tm _ _ run.ordered run.settled (Expiry.latestFits s) run.sorted
  have range : Preview.q s tm ≤ stored s .latest := cut.2.1
  have postRecords := Release.preservesRecords H.records tm time qf sep
  have endEq (i : Nat) (hi : i≤stored s .latest) : Expiry.endsAt (Release.post s tm) i = Expiry.endsAt s i := by
    have le := H.records.count ▸ hi
    exact (recordFields postRecords i le true).1.trans (recordFields H.records i le true).1.symm
  refine {
    records := postRecords
    duration := duration.trans H.duration
    positive := H.positive
    through := fun f mem => (le_trans (H.through f mem) forward).trans_eq through.symm
    groupedCap := H.groupedCap
    settledRange := ?_
    settledPast := ?_
    sorted := ?_
    cursor := ?_
    accounted := ?_
    earned := ?_ }
  · rwa [settled,latest]
  · rw [settled,through,endEq _ range]
    by_cases zero : Preview.q s tm=0
    · exact Or.inl zero
    · exact Or.inr ((cut.2.2 _ (Nat.pos_of_ne_zero zero) range).mpr le_rfl)
  · intro i j pos le max
    rw [latest] at max
    rw [endEq _ (le_trans le max),endEq _ max]
    exact H.sorted _ _ pos le max
  · intro eth
    rw [(Release.amounts _ _ eth run).1,Release.cursor,H.cursor,H.duration,Nat.add_mul,Nat.add_assoc]
  · intro eth
    rw [(Release.amounts _ _ eth run).2,Release.leftover,←H.accounted eth]
    rw [Nat.add_comm (paid eth),←Nat.add_assoc,Nat.sub_add_cancel (run.funded eth)]
  · intro eth
    rw [through,lifetimeAfter H tm forward eth,vested]
    have initial := le_trans (Nat.le_add_right _ _) (H.earned eth)
    have up := le_trans initial (monotone d _ _ _ forward)
    have rounded := Nat.div_mul_le_self (integral d tm (streams eth fs)-baseline (streams eth fs)) d
    omega
end Inv08.FundingHistory
