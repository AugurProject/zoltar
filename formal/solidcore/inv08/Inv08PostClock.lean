import Inv08PackedWrite
import Inv08ReleaseState
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Release

private theorem beforeClock (s : State) (tm : Nat) : (repDebited s tm).loadSlot 0 = s.loadSlot 0 := by
  change ((((s.storeSlot 5 _).storeSlot 6 _).storeSlot 1 _).storeSlot 2 _).loadSlot 0 = _
  simp only [slotAfter]
  norm_num [Shared.norm,Shared.wordModulus,EvmYul.UInt256.size]

private theorem storeThrough (s : State) (tm : Nat) :
    (s.storeFieldWord Field.through.field tm).loadSlot 0 = Packed.replace (s.loadSlot 0) 0 tm := by
  change (s.storeSlot 0 _).loadSlot 0 = _
  rw [slotAfter,if_pos rfl]; rfl
private theorem storeSettled (s : State) (id : Nat) :
    (s.storeFieldWord Field.settled.field id).loadSlot 0 = Packed.replace (s.loadSlot 0) 96 id := by
  change (s.storeSlot 0 _).loadSlot 0 = _
  rw [slotAfter,if_pos rfl]; rfl

theorem throughRead (s : State) : stored s .through = wordBitRange 0 48 (s.loadSlot 0) := rfl
theorem latestRead (s : State) : stored s .latest = wordBitRange 48 48 (s.loadSlot 0) := rfl
theorem settledRead (s : State) : stored s .settled = wordBitRange 96 48 (s.loadSlot 0) := rfl
theorem durationRead (s : State) : stored s .duration = wordBitRange 144 48 (s.loadSlot 0) := rfl

theorem clock (s : State) (tm : Nat) (tf : tm < Packed.B) (qf : Preview.q s tm < Packed.B) :
    stored (post s tm) .through = tm ∧ stored (post s tm) .latest = stored s .latest ∧
    stored (post s tm) .settled = Preview.q s tm ∧ stored (post s tm) .duration = stored s .duration := by
  let word := s.loadSlot 0
  obtain ⟨x,seen⟩ := Packed.represent word
  let t : Fin Packed.B := ⟨tm,tf⟩
  let q : Fin Packed.B := ⟨Preview.q s tm,qf⟩
  let y := {x with a:=t}
  let z := {y with c:=q}
  have first : (timestamped s tm).loadSlot 0 = y.pack := by
    rw [timestamped,storeThrough,beforeClock]
    exact Packed.setThrough word x seen t
  have last : (post s tm).loadSlot 0 = z.pack := by
    rw [post,storeSettled,first]
    exact Packed.setSettled y.pack y (Nat.mod_eq_of_lt (Packed.fits y)) q
  have before (off : Nat) : wordBitRange off 48 word = wordBitRange off 48 x.pack := by
    simp [wordBitRange,seen,show Shared.norm x.pack=x.pack from Nat.mod_eq_of_lt (Packed.fits x)]
  simp only [throughRead,latestRead,settledRead,durationRead]
  change _ = _ ∧ _ = wordBitRange 48 48 word ∧ _ = _ ∧ _ = wordBitRange 144 48 word
  rw [last,before 48,before 144]
  obtain ⟨za,zb,zc,zd⟩ := Packed.readDigits z
  obtain ⟨_,xb,_,xd⟩ := Packed.readDigits x
  exact ⟨za,zb.trans xb.symm,zc,zd.trans xd.symm⟩
end Inv08.Release
