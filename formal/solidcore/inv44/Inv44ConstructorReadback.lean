import Inv44ConstructorStorage
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44.Constructor

private theorem dataRange : 0<Shared.norm (dynamicArrayDataSlot 0) ∧ Shared.norm (dynamicArrayDataSlot 0)+256<R := by
  native_decide

private theorem raw (i : Nat) (cap : i≤256) : Shared.norm (slot i)= Shared.norm (dynamicArrayDataSlot 0)+i := by
  have fit := lt_of_le_of_lt (Nat.add_le_add_left cap _) dataRange.2
  change ((_+i)%R)%R=_
  rw [Nat.mod_mod,Nat.mod_eq_of_lt fit]

private theorem prior (xs : List Nat) (s : State) (start j : Nat) (earlier : j<start)
    (cap : start+xs.length≤256) : (cells s start xs).loadSlot (slot j)=s.loadSlot (slot j) := by
  induction xs generalizing s start with
  | nil => rfl
  | cons x xs ih =>
    have bound : start+1+xs.length≤256 := by simp at cap; omega
    rw [cells,ih _ _ (by omega) bound,Inv08.slotAfter,if_neg]
    intro h
    rw [raw _ (by omega),raw _ (by omega)] at h
    exact Nat.ne_of_gt earlier (Nat.add_left_cancel h)

private theorem cellValue (xs : List Nat) (s : State) (start i : Nat) (inside : i<xs.length)
    (cap : start+xs.length≤256) : (cells s start xs).loadSlot (slot (start+i)) = Shared.norm xs[i] := by
  induction xs generalizing s start i with
  | nil => simp at inside
  | cons x xs ih =>
    have bound : start+1+xs.length≤256 := by simp at cap; omega
    cases i with
    | zero =>
      simp only [Nat.add_zero,cells,List.getElem_cons_zero]
      rw [prior _ _ _ _ (by omega) bound,Inv08.slotAfter,if_pos rfl]
      exact Nat.mod_mod _ _
    | succ i =>
      have same : start+(i+1)=start+1+i := by omega
      simpa only [cells,same,List.getElem_cons_succ] using ih (s.storeSlot (slot start) (Shared.norm x))
        (start+1) i (by simpa using inside) bound

theorem installCount (xs : List Nat) (s : State) (cap : xs.length≤256) : count (install xs s)=xs.length := by
  unfold count install
  rw [Inv08.slotAfter,if_pos rfl]
  exact Nat.mod_eq_of_lt (lt_of_le_of_lt cap (by decide : 256<R))

theorem installAddress (xs : List Nat) (s : State) (i : Nat) (inside : i<xs.length) (cap : xs.length≤256) :
    address (install xs s) i=Shared.Account.addressWord xs[i] := by
  have nz : Shared.norm 0≠Shared.norm (slot i) := by
    rw [raw i (by omega),show Shared.norm 0=0 from rfl]
    have pos := dataRange.1
    exact Nat.ne_of_lt (pos.trans_le (Nat.le_add_right _ _))
  have v := cellValue xs s 0 i inside (by simpa using cap)
  simp only [Nat.zero_add] at v
  unfold address install
  rw [Inv08.slotAfter,if_neg nz,v]
  simp [Shared.Account.addressWord,Shared.norm]
end Inv44.Constructor
