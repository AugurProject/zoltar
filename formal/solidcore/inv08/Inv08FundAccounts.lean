import Inv08PostAmounts
import Inv08FundingSlots
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.AddStream
open FundingHistory ExpiryStorage

theorem afterId (s : State) (f : Funding) (p : Record) (k : Field) (diff : Field.latest.slot≠k.slot) :
    stored (withId s f p) k = stored (withOutstanding s f) k := by
  unfold withId
  split
  · rfl
  · apply otherField _ _ _ _ diff

theorem debitFields (s : State) (f : Funding) (p : Record) (limit : Nat) (sep : Separated limit)
    (bound : nextId s f p≤limit) (eth : Bool) (fit : stored s (outstandingField eth)+(stream eth f).budget < R) :
    stored (post s f p) (outstandingField eth) = stored s (outstandingField eth)+(stream eth f).budget := by
  unfold post withEthCursor withRecord
  cases eth <;> simp only [outstandingField, Nat.reduceAdd,stream,Bool.false_eq_true,if_false,if_true]
  all_goals
    rw [otherField _ .repCursor _ _ (by decide),otherField _ .ethCursor _ _ (by decide),afterRecord _ _ _ bound sep,
      afterId _ _ _ _ (by decide)]
    unfold withOutstanding withEth
  · exact Release.readWritten _ _ _ rfl rfl fit
  · rw [otherField _ .repOut .ethOut _ (by decide)]
    exact Release.readWritten _ _ _ rfl rfl fit

theorem cursorFields (s : State) (f : Funding) (p : Record) (eth : Bool)
    (fit : stored s (cursorField eth)+(stream eth f).budget*f.time < R) :
    stored (post s f p) (cursorField eth)=stored s (cursorField eth)+(stream eth f).budget*f.time := by
  cases eth <;> unfold post withEthCursor
  · exact Release.readWritten _ .repCursor _ rfl rfl fit
  · change stored ((_ : State).storeFieldWord Field.repCursor.field _) .ethCursor = _
    rw [otherField _ .repCursor .ethCursor _ (by decide)]
    exact Release.readWritten _ .ethCursor _ rfl rfl fit

theorem header (s : State) (f : Funding) (p : Record) (k : Field) (slot : k.slot=0)
    (limit : Nat) (sep : Separated limit) (bound : nextId s f p≤limit) :
    stored (post s f p) k = stored (withId s f p) k := by
  unfold post withEthCursor withRecord
  have five : Field.ethCursor.slot≠k.slot := slot ▸ (by decide)
  have six : Field.repCursor.slot≠k.slot := slot ▸ (by decide)
  rw [otherField _ _ _ _ six,otherField _ _ _ _ five,afterRecord _ _ _ bound sep]

theorem clockFields (s : State) (f : Funding) (p : Record) (limit : Nat) (sep : Separated limit)
    (bound : nextId s f p≤limit) (fit : nextId s f p < Packed.B) :
    stored (post s f p) .through=stored s .through ∧ stored (post s f p) .duration=stored s .duration ∧
    stored (post s f p) .settled=stored s .settled := by
  rw [header _ _ _ .through rfl _ sep bound,header _ _ _ .duration rfl _ sep bound,header _ _ _ .settled rfl _ sep bound]
  have prior (k : Field) (le : k.slot=0) := olderScalar s f k (by rw [le]; decide) (by rw [le]; decide)
  unfold withId
  split
  · exact ⟨prior _ rfl,prior _ rfl,prior _ rfl⟩
  · obtain ⟨_,a,b,c⟩ := Packed.latestField (withOutstanding s f) _ fit
    exact ⟨a.trans (prior _ rfl),b.trans (prior _ rfl),c.trans (prior _ rfl)⟩
end Inv08.AddStream
