import Inv08FundingHistory
import Inv08FundingRecord
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory

def get (c : Context) (r : Runtime) (id : Nat) (fs : List Funding) (d : Nat) :=
  r.loadStorageIndex c "expiries" (.word id) = .ok (.tuple (record d fs).words)

theorem readNextRecord (c : Context) (r : Runtime) (id d : Nat) (earlier : List Funding) (f : Funding)
    (fields : c.storageFields = model.core.context.storageFields) (idFits : id<R)
    (fits : ExpiryStorage.Fits (add d (record d earlier) f)) :
    let next := add d (record d earlier) f
    let updated := {r with state := ExpiryStorage.install r.state (mappingStorageSlot 7 id) next}
    r.storeStorageIndexWithDeepClear c "expiries" (.word id) (.tuple next.words) = .ok updated ∧
    get c updated id (earlier++[f]) d := by
  dsimp only [get]
  rw [show record d (earlier++[f]) = add d (record d earlier) f from append d earlier f]
    <;> exact ExpiryStorage.readInstalled c r id idFits _ fits fields

/-- Only the five slots belonging to the newly written expiry record change. -/
theorem frameSlot (s : State) (slot key : Nat) (e : ExpiryStorage.Record)
    (different : ∀ i : Fin 5, SolidCore.Solidity.Shared.norm (ExpiryStorage.memberSlot slot i) ≠
      SolidCore.Solidity.Shared.norm key) :
    (ExpiryStorage.install s slot e).loadSlot key = s.loadSlot key := by
  dsimp only [ExpiryStorage.install]
  rw [ExpiryStorage.unaffected _ slot 4 _ key (different 4),ExpiryStorage.unaffected _ slot 3 _ key (different 3),
    ExpiryStorage.unaffected _ slot 2 _ key (different 2),ExpiryStorage.unaffected _ slot 1 _ key (different 1),
    ExpiryStorage.unaffected _ slot 0 _ key (different 0)]

theorem otherRecord (s : State) (slot other : Nat) (e : ExpiryStorage.Record)
    (apart : ∀ i j : Fin 5, SolidCore.Solidity.Shared.norm (ExpiryStorage.memberSlot slot i) ≠
      SolidCore.Solidity.Shared.norm (ExpiryStorage.memberSlot other j)) :
    ExpiryStorage.tuple (ExpiryStorage.install s slot e) other = ExpiryStorage.tuple s other := by
  unfold ExpiryStorage.tuple ExpiryStorage.memberWord
  have unchanged (j : Nat) (lt : j<5) : (ExpiryStorage.install s slot e).loadSlot (ExpiryStorage.memberSlot other j) = s.loadSlot (ExpiryStorage.memberSlot other j) := frameSlot s slot _ e (fun i => apart i ⟨j,lt⟩)
  rw [unchanged 0 (by decide),unchanged 1 (by decide),unchanged 2 (by decide),unchanged 3 (by decide),unchanged 4 (by decide)]

end Inv08.FundingHistory
