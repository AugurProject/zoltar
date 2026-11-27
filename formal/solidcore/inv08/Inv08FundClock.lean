import Inv08PostClock
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Packed
theorem setLatest (w : Nat) (x : Digits) (seen : Shared.norm w=x.pack) (v : Fin B) :
    replace w 48 v = ({x with b:=v}).pack := by
  have small : Shared.norm v.val=v := Nat.mod_eq_of_lt (lt_trans v.isLt (by decide))
  have previous := (readDigits x).2.1
  have normalization : Shared.norm ((Shared.norm x.pack / 2^48)%B) = (Shared.norm x.pack / 2^48)%B :=
    Nat.mod_eq_of_lt (lt_trans (Nat.mod_lt _ (by decide)) (by decide : B<R))
  change Shared.norm ((Shared.norm x.pack/2^48)%B) = x.b.val at previous
  rw [normalization,show Shared.norm x.pack=x.pack from Nat.mod_eq_of_lt (fits x)] at previous
  have updated : x.pack-(x.b.val*2^48)+v.val*2^48=({x with b:=v}).pack := by
    unfold Digits.pack
    norm_num [B]
    omega
  have normal : Shared.norm ({x with b:=v}).pack = ({x with b:=v}).pack := Nat.mod_eq_of_lt (fits _)
  simp only [replace,wordReplaceBitRange,show (48==0)=false by decide,Bool.false_eq_true,if_false,seen,
    small,Nat.mod_eq_of_lt v.isLt,previous,updated,normal]

theorem latestField (s : State) (id : Nat) (fit : id<B) :
    let updated := s.storeFieldWord Field.latest.field id
    stored updated .latest=id ∧ stored updated .through=stored s .through ∧
    stored updated .duration=stored s .duration ∧ stored updated .settled=stored s .settled := by
  obtain ⟨x,seen⟩ := represent (s.loadSlot 0)
  let v : Fin B := ⟨id,fit⟩
  let y := {x with b:=v}
  have storedWord : (s.storeFieldWord Field.latest.field id).loadSlot 0 = y.pack := by
    change (s.storeSlot 0 _).loadSlot 0 = _
    rw [slotAfter,if_pos rfl]
    exact setLatest _ _ seen v
  have before (off : Nat) : wordBitRange off 48 (s.loadSlot 0) = wordBitRange off 48 x.pack := by
    simp [wordBitRange,seen,show Shared.norm x.pack=x.pack from Nat.mod_eq_of_lt (fits x)]
  dsimp only
  simp only [Release.latestRead,Release.throughRead,Release.durationRead,Release.settledRead,storedWord]
  rw [before 0,before 144,before 96]
  obtain ⟨ya,yb,yc,yd⟩ := readDigits y
  obtain ⟨xa,_,xc,xd⟩ := readDigits x
  exact ⟨yb,ya.trans xa.symm,yd.trans xd.symm,yc.trans xc.symm⟩
end Inv08.Packed
