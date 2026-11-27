import Inv39SupplyWrites
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
theorem mintDelta (s : State) (a : Nat) (fit : s.loadSlot circulating.slot+a < R) :
    balances (s.storeSlot circulating.slot (s.loadSlot circulating.slot+a)) =
      {balances s with circulating := (balances s).circulating + a} := by
  simp only [balances,WordField.stored,Supply.mk.injEq]
  exact ⟨loadUnchanged _ _ _ _ (by decide),loadChanged _ _ _ fit⟩
theorem burnDelta (s : State) (a : Nat) (circFit : s.loadSlot circulating.slot < R)
    (theoryFit : s.loadSlot theoretical.slot < R) :
    let debit := s.storeSlot circulating.slot (s.loadSlot circulating.slot-a)
    balances (debit.storeSlot theoretical.slot (debit.loadSlot theoretical.slot-a)) =
      ⟨(balances s).theoretical-a,(balances s).circulating-a⟩ := by
  dsimp only
  have diff : Shared.norm circulating.slot ≠ Shared.norm theoretical.slot := by decide
  have thUnchanged := loadUnchanged s circulating.slot (s.loadSlot circulating.slot-a) theoretical.slot diff
  simp only [balances,WordField.stored,Supply.mk.injEq]
  constructor
  · rw [thUnchanged,loadChanged _ _ _ (lt_of_le_of_lt (Nat.sub_le _ _) theoryFit)]
  · rw [loadUnchanged _ _ _ _ (Ne.symm diff),loadChanged _ _ _ (lt_of_le_of_lt (Nat.sub_le _ _) circFit)]
end Inv39
