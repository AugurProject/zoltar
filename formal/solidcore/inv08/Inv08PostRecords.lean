import Inv08HistoryReady
import Inv08PostClock
import Inv08Separation
open SolidCore.Solidity.Source
namespace Inv08.Release
open ExpiryStorage FundingHistory

theorem recordUnchanged (s : State) (tm last id : Nat) (bound : id≤last) (sep : Separated last) :
    tuple (post s tm) (mappingStorageSlot 7 id) = tuple s (mappingStorageSlot 7 id) := by
  unfold post timestamped repDebited ethDebited repCredited ethCredited
  repeat rw [beforeRecord _ _ _ bound sep]

theorem preservesRecords (H : Records s d fs) (tm : Nat) (time : tm<Packed.B) (qBound : Preview.q s tm<Packed.B)
    (sep : Separated fs.length) : Records (post s tm) d fs := by
  have clockEq := clock s tm time qBound
  exact ⟨clockEq.2.1.trans H.count,fun i le => (recordUnchanged _ _ _ _ le sep).trans (H.entries i le)⟩
end Inv08.Release
