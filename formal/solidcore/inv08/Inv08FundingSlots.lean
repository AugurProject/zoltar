import Inv08FundingStages
open SolidCore.Solidity.Source
namespace Inv08.AddStream
open FundingHistory ExpiryStorage

theorem preMapTuple (s : State) (f : Funding) (p : Record) (id limit : Nat) (bound : id≤limit) (sep : Separated limit) :
    tuple (withId s f p) (mappingStorageSlot 7 id) = tuple s (mappingStorageSlot 7 id) := by
  have prior : tuple (withOutstanding s f) (mappingStorageSlot 7 id)=tuple s (mappingStorageSlot 7 id) := by
    unfold withOutstanding withEth
    rw [beforeRecord _ _ _ bound sep .repOut _,beforeRecord _ _ _ bound sep .ethOut _]
  unfold withId
  split
  · exact prior
  · exact (beforeRecord _ _ _ bound sep .latest _).trans prior

theorem afterCursors (s : State) (f : Funding) (p : Record) (id limit : Nat) (bound : id≤limit) (sep : Separated limit) :
    tuple (post s f p) (mappingStorageSlot 7 id) = tuple (withRecord s f p) (mappingStorageSlot 7 id) := by
  unfold post withEthCursor
  rw [beforeRecord _ _ _ bound sep .repCursor _,beforeRecord _ _ _ bound sep .ethCursor _]

theorem postNew (s : State) (f : Funding) (p : Record) (limit : Nat) (sep : Separated limit)
    (bound : nextId s f p≤limit) (fits : Fits (add (stored s .duration) p f)) :
    tuple (post s f p) (mappingStorageSlot 7 (nextId s f p)) = .tuple (add (stored s .duration) p f).words :=
  (afterCursors _ _ _ _ _ bound sep).trans (installReads _ _ _ fits)

theorem postOld (s : State) (f : Funding) (p : Record) (id limit : Nat) (sep : Separated limit)
    (old : id≤limit) (bound : nextId s f p≤limit) (diff : nextId s f p≠id) :
    tuple (post s f p) (mappingStorageSlot 7 id) = tuple s (mappingStorageSlot 7 id) :=
  (afterCursors _ _ _ _ _ old sep).trans ((otherRecord _ _ _ _ (sep.different _ _ bound old diff)).trans
    (preMapTuple _ _ _ _ _ old sep))

theorem postId (s : State) (f : Funding) (p : Record) (limit : Nat) (sep : Separated limit)
    (bound : nextId s f p≤limit) (stage : StageReads s f p) : stored (post s f p) .latest = nextId s f p := by
  unfold post withEthCursor withRecord
  rw [otherField _ .repCursor .latest _ (by decide),otherField _ .ethCursor .latest _ (by decide),
    afterRecord _ _ _ bound sep,stage.finalId]
end Inv08.AddStream
