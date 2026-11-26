import Inv08RecordReadback
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.ExpiryStorage

theorem neighbour (slot i j : Nat) (hi : i<5) (hj : j<5) (ne : i≠j) :
    Shared.norm (memberSlot slot i) ≠ Shared.norm (memberSlot slot j) := by
  change (((slot%R+i)%R)%R) ≠ (((slot%R+j)%R)%R)
  simp only [Nat.mod_mod]
  have bound : slot%R < R := Nat.mod_lt _ (by decide)
  unfold R at *
  omega

theorem otherMember (s : State) (slot i j v : Nat) (hi : i<5) (hj : j<5) (ne : i≠j) :
    memberWord (storeMember s slot i v) slot j = memberWord s slot j := by
  unfold memberWord
  rw [unaffected _ _ _ _ _ (neighbour _ _ _ hi hj ne)]

structure Fits (e : Record) : Prop where
  endBound : e.endAt < 2^48
  ethBound : e.ethRate < R
  repBound : e.repRate < R
  ethWeightBound : e.ethWeighted < R
  repWeightBound : e.repWeighted < R

theorem installReads (s : State) (slot : Nat) (e : Record) (h : Fits e) :
    tuple (install s slot e) slot = .tuple e.words := by
  unfold tuple install Record.words
  simp (disch := decide) only [otherMember]
  rw [readAfter _ _ _ _ h.endBound,readAfter _ _ _ _ h.ethBound,readAfter _ _ _ _ h.repBound,
    readAfter _ _ _ _ h.ethWeightBound,readAfter _ _ _ _ h.repWeightBound]

end Inv08.ExpiryStorage
