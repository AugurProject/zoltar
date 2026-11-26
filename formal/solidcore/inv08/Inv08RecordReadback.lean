import Inv08RecordWrite
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.ExpiryStorage
theorem bitReadback (w cur v : Nat) (pos : 0 < w) (fits : v < 2^w) (within : w≤256) :
    wordBitRange 0 w (Shared.norm (wordReplaceBitRange 0 w cur (Shared.norm v))) = v := by
  have divides : 2^w ∣ R := Nat.pow_dvd_pow 2 within
  have word : v<R := lt_of_lt_of_le fits (Nat.pow_le_pow_right (by decide) within)
  have nv : Shared.norm v = v := Nat.mod_eq_of_lt word
  have n := Nat.mod_add_div (Shared.norm cur) (2^w)
  have remLe := Nat.mod_le (Shared.norm cur) (2^w)
  have diff : Shared.norm cur - Shared.norm cur % (2^w) = 2^w * (Shared.norm cur / 2^w) := by
    exact (congrArg (fun x => x - Shared.norm cur % (2^w)) n.symm).trans (Nat.add_sub_cancel_left _ _)
  simp only [wordBitRange,wordReplaceBitRange,show (w == 0) = false by simp [Nat.ne_of_gt pos],
    Bool.false_eq_true,if_false,Nat.pow_zero,Nat.div_one,Nat.mul_one,nv,Nat.mod_eq_of_lt fits,diff]
  unfold Shared.norm
  change ((((((2^w * (cur%R/2^w) + v)%R)%R)%R)%(2^w))%R) = v
  simp [Nat.mod_mod_of_dvd _ divides,Nat.mul_add_mod_self_left,Nat.mod_eq_of_lt fits,Nat.mod_eq_of_lt word]

theorem readAfter (s : State) (slot i v : Nat) (fits : v < 2^(if i=0 then 48 else 256)) :
    memberWord (storeMember s slot i v) slot i = v := by
  unfold memberWord storeMember
  rw [slotAfter,if_pos rfl]
  exact bitReadback _ _ v (by split <;> decide) fits (by split <;> decide)

theorem unaffected (s : State) (slot i v key : Nat) (sep : Shared.norm (memberSlot slot i) ≠ Shared.norm key) :
    (storeMember s slot i v).loadSlot key = s.loadSlot key := by
  unfold storeMember
  rw [slotAfter,if_neg sep]

end Inv08.ExpiryStorage
