import Inv08Separation
import Inv08FundClock
import Inv08AddStreamState
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv08.AddStream
open FundingHistory ExpiryStorage

theorem otherField (s : State) (k j : Field) (a : Nat) (diff : k.slot≠j.slot) :
    stored (s.storeFieldWord k.field a) j=stored s j := by
  have small (x : Field) : Shared.norm x.slot=x.slot := by cases x <;> decide
  exact scalarCongr _ _ j (frameField _ _ _ _ (by rwa [small,small]))

theorem olderScalar (s : State) (f : Funding) (k : Field) (one : Field.ethOut.slot≠k.slot)
    (two : Field.repOut.slot≠k.slot) : stored (withOutstanding s f) k = stored s k := by
  unfold withOutstanding withEth
  rw [otherField _ _ _ _ two,otherField _ _ _ _ one]

theorem stages (s : State) (f : Funding) (previous : Record) (last : Nat)
    (sep : Separated last) (idRange : nextId s f previous ≤ last)
    (fits : nextId s f previous < Packed.B) (now : stored s .through=f.time)
    (old : tuple s (mappingStorageSlot 7 (stored s .latest)) = .tuple previous.words) :
    StageReads s f previous := by
  have oldRange : stored s .latest ≤ last :=
    le_trans (Nat.le_add_right _ _) idRange
  have through := olderScalar s f .through (by decide) (by decide)
  have duration := olderScalar s f .duration (by decide) (by decide)
  have latest := olderScalar s f .latest (by decide) (by decide)
  have identifier : stored (withId s f previous) .latest=nextId s f previous := by
    unfold withId
    split
    next eq => simp [nextId,eq,latest]
    next => exact (Packed.latestField _ _ fits).1
  have unchanged (k : Field) (diff : Field.latest.slot≠k.slot) :
      stored (withId s f previous) k=stored (withOutstanding s f) k := by
    unfold withId
    split
    · rfl
    · exact otherField _ _ _ _ diff
  have clock : stored (withId s f previous) .through = f.time := by
    unfold withId
    split
    · exact through.trans now
    · exact (Packed.latestField _ _ fits).2.1.trans (through.trans now)
  have mapped (k : Field) : stored (withRecord s f previous) k=stored (withId s f previous) k :=
    afterRecord _ _ _ idRange sep _ _
  have cursor (k : Field) (k0 : Field.latest.slot≠k.slot) (k1 : Field.ethOut.slot≠k.slot) (k2 : Field.repOut.slot≠k.slot) :
      stored (withRecord s f previous) k=stored s k :=
    (mapped k).trans ((unchanged k k0).trans (olderScalar _ _ _ k1 k2))
  refine ⟨otherField _ .ethOut .repOut _ (by decide),through.trans now,duration,latest,?_,identifier,
    (mapped _).trans clock,cursor _ (by decide) (by decide) (by decide),?_,?_⟩
  · unfold withOutstanding withEth
    rw [beforeRecord _ _ _ oldRange sep .repOut _,beforeRecord _ _ _ oldRange sep .ethOut _,old]
  · exact (otherField _ .ethCursor .through _ (by decide)).trans ((mapped _).trans clock)
  · exact (otherField _ .ethCursor .repCursor _ (by decide)).trans (cursor _ (by decide) (by decide) (by decide))

end Inv08.AddStream
