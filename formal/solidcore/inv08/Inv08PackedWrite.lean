import Inv08PackedDigits
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Packed

def replace (raw o v : Nat) := Shared.norm (wordReplaceBitRange o 48 raw v)

private theorem rawDigit (w o : Nat) :
    wordBitRange o 48 w = (Shared.norm w / 2^o)%B := by
  change Shared.norm ((Shared.norm w / 2^o)%B) = _
  exact Nat.mod_eq_of_lt (lt_trans (Nat.mod_lt _ (by decide : 0<B)) (by decide : B<R))

theorem setThrough (w : Nat) (x : Digits) (seen : Shared.norm w=x.pack) (v : Fin B) :
    replace w 0 v = ({x with a:=v}).pack := by
  have small : Shared.norm v.val=v := Nat.mod_eq_of_lt (lt_trans v.isLt (by decide))
  have previous := (readDigits x).1
  rw [rawDigit,show Shared.norm x.pack=x.pack from Nat.mod_eq_of_lt (fits x)] at previous
  simp only [Nat.pow_zero,Nat.div_one] at previous
  have sub : x.pack - x.a = B*(x.b.val+B*(x.c.val+B*(x.d.val+B*x.high.val))) := Nat.add_sub_cancel_left _ _
  have updated : x.pack-x.a+v=({x with a:=v}).pack := by rw [sub]; exact Nat.add_comm _ _
  have normal : Shared.norm ({x with a:=v}).pack = ({x with a:=v}).pack := Nat.mod_eq_of_lt (fits _)
  simp only [replace,wordReplaceBitRange,show (48==0)=false by decide,Bool.false_eq_true,if_false,seen,
    Nat.pow_zero,Nat.div_one,Nat.mul_one,small,Nat.mod_eq_of_lt v.isLt,previous,updated,normal]

theorem setSettled (w : Nat) (x : Digits) (seen : Shared.norm w=x.pack) (v : Fin B) :
    replace w 96 v = ({x with c:=v}).pack := by
  have small : Shared.norm v.val=v := Nat.mod_eq_of_lt (lt_trans v.isLt (by decide))
  have previous := (readDigits x).2.2.1
  rw [rawDigit,show Shared.norm x.pack=x.pack from Nat.mod_eq_of_lt (fits x)] at previous
  have updated : x.pack-(x.c.val*2^96)+v.val*2^96=({x with c:=v}).pack := by
    unfold Digits.pack
    norm_num [B]
    omega
  have normal : Shared.norm ({x with c:=v}).pack = ({x with c:=v}).pack := Nat.mod_eq_of_lt (fits _)
  simp only [replace,wordReplaceBitRange,show (48==0)=false by decide,Bool.false_eq_true,if_false,seen,
    small,Nat.mod_eq_of_lt v.isLt,previous,updated,normal]

end Inv08.Packed
