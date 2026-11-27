import Inv08FundingCount
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory

def initializeStorage (s : State) (tm d : Nat) :=
  (s.storeFieldWord Field.duration.field d).storeFieldWord Field.through.field tm

theorem genesis (s : State) (tm d : Nat) (zero : ∀ i,s.loadSlot i=0) (sep : Separated 0)
    (timeFit : tm<Packed.B) (durationFit : d<Packed.B) (pos : 0<d) :
    Accounts (initializeStorage s tm d) d [] (fun _ => 0) ∧ stored (initializeStorage s tm d) .through=tm := by
  let x : Packed.Digits := ⟨0,0,0,⟨d,durationFit⟩,0⟩
  let y := {x with a:=⟨tm,timeFit⟩}
  let mid := s.storeFieldWord Field.duration.field d
  let out := initializeStorage s tm d
  have first : mid.loadSlot 0=x.pack := by
    change (s.storeSlot 0 _).loadSlot 0=_
    rw [slotAfter,if_pos rfl]
    change Shared.norm (wordReplaceBitRange 144 48 (s.loadSlot 0) d)=x.pack
    rw [zero]
    have small : Shared.norm d=d := Nat.mod_eq_of_lt (lt_trans durationFit (by decide))
    have fit := Nat.mod_eq_of_lt (Packed.fits x)
    change x.pack % R=x.pack at fit
    have digit : d % 2^48=d := Nat.mod_eq_of_lt durationFit
    have packed : d*2^144=x.pack := by simp [x,Packed.Digits.pack,Packed.B]; omega
    simp only [wordReplaceBitRange,show (48==0)=false by decide,Bool.false_eq_true,if_false,small,digit]
    simp only [show Shared.norm 0=0 from rfl,Nat.zero_div,Nat.zero_mod,Nat.zero_mul,Nat.sub_zero,Nat.zero_add,packed]
    change (x.pack % R) % R=x.pack
    rw [fit,fit]
  have top : out.loadSlot 0=y.pack := by
    change (mid.storeSlot 0 _).loadSlot 0=_
    rw [slotAfter,if_pos rfl]
    change Packed.replace (mid.loadSlot 0) 0 tm=y.pack
    rw [first]
    exact Packed.setThrough _ x (Nat.mod_eq_of_lt (Packed.fits x)) ⟨tm,timeFit⟩
  have other (i : Nat) (diff : Shared.norm i ≠ 0) : out.loadSlot i=0 := by
    change ((s.storeSlot 0 _).storeSlot 0 _).loadSlot i=_
    simp only [slotAfter,show Shared.norm 0=0 from rfl,if_neg diff.symm,zero]
  obtain ⟨clock,count,settled,duration⟩ := Packed.readDigits y
  rw [←top] at clock count settled duration
  change stored out .through=tm at clock
  change stored out .latest=0 at count
  change stored out .settled=0 at settled
  change stored out .duration=d at duration
  have member (i : Nat) (hi : i<5) : ExpiryStorage.memberWord out (mappingStorageSlot 7 0) i=0 := by
    unfold ExpiryStorage.memberWord
    rw [other _ (sep.scalar 0 le_rfl ⟨i,hi⟩ 0 (by decide))]
    by_cases e : i=0 <;> simp [e,wordBitRange] <;> rfl
  have entries : Records out d [] := by
    refine ⟨count,?_⟩
    intro i hi
    have id : i=0 := Nat.eq_zero_of_le_zero hi
    subst i
    unfold ExpiryStorage.tuple
    rw [member 0 (by decide),member 1 (by decide),member 2 (by decide),member 3 (by decide),member 4 (by decide)]
    rfl
  refine ⟨⟨entries,duration,pos,by simp,by simp,settled.le.trans_eq count.symm,Or.inl settled,?_,?_,?_,?_⟩,clock⟩
  · intro i j hi hj last
    change j≤stored out .latest at last
    exact False.elim ((Nat.not_lt_of_ge (hj.trans (last.trans_eq count))) hi)
  · intro eth
    simp only [Nat.zero_mul,Nat.add_zero]
    cases eth
    · exact other 6 (by decide)
    · exact other 5 (by decide)
  · intro eth
    cases eth
    · exact other 2 (by decide)
    · exact other 1 (by decide)
  · intro eth
    simp [streams,baseline,integral]

end Inv08.FundingHistory
