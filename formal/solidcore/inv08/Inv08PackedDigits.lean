import Inv08RecordReadback
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Packed
abbrev B : Nat := 2^48
structure Digits where
  a : Fin B
  b : Fin B
  c : Fin B
  d : Fin B
  high : Fin (2^64)
def Digits.pack (x : Digits) := x.a.val + B*(x.b.val+B*(x.c.val+B*(x.d.val+B*x.high.val)))
theorem fits (x : Digits) : x.pack < R := by
  obtain ⟨⟨a,ha⟩,⟨b,hb⟩,⟨c,hc⟩,⟨d,hd⟩,⟨h,hh⟩⟩ := x
  change a+B*(b+B*(c+B*(d+B*h)))<R
  norm_num [B,R] at *
  omega
def splitWord (n : Nat) : Nat × Nat := (n%B,n/B)
private theorem decomp (n : Nat) : n = (splitWord n).1 + B*(splitWord n).2 := (Nat.mod_add_div _ _).symm

theorem represent (w : Nat) : ∃ x : Digits, Shared.norm w = x.pack := by
  let n := Shared.norm w
  have bound : n < R := Nat.mod_lt _ (by decide)
  let n1 := n/B
  let n2 := n1/B
  let n3 := n2/B
  let n4 := n3/B
  have top : n4 < 2^64 := by
    dsimp [n4,n3,n2,n1]
    rw [Nat.div_div_eq_div_mul,Nat.div_div_eq_div_mul,Nat.div_div_eq_div_mul,Nat.div_lt_iff_lt_mul (by decide)]
    exact bound
  refine ⟨⟨⟨n%B,Nat.mod_lt _ (by decide)⟩,⟨n1%B,Nat.mod_lt _ (by decide)⟩,⟨n2%B,Nat.mod_lt _ (by decide)⟩,
    ⟨n3%B,Nat.mod_lt _ (by decide)⟩,⟨n4,top⟩⟩,?_⟩
  change n=n%B+B*(n1%B+B*(n2%B+B*(n3%B+B*n4)))
  rw [show n3%B+B*n4=n3 from Nat.mod_add_div _ _,show n2%B+B*n3=n2 from Nat.mod_add_div _ _,
    show n1%B+B*n2=n1 from Nat.mod_add_div _ _,Nat.mod_add_div]

private theorem step (x : Fin B) (next : Nat) : (x.val+B*next)/B = next := by
  rw [Nat.add_mul_div_left _ _ (by decide),Nat.div_eq_of_lt x.isLt,Nat.zero_add]

theorem readDigits (x : Digits) :
    wordBitRange 0 48 x.pack = x.a ∧ wordBitRange 48 48 x.pack = x.b ∧
    wordBitRange 96 48 x.pack = x.c ∧ wordBitRange 144 48 x.pack = x.d := by
  have normal : Shared.norm x.pack = x.pack := Nat.mod_eq_of_lt (fits x)
  have small (k : Fin B) : Shared.norm k.val=k.val := Nat.mod_eq_of_lt (lt_trans k.isLt (by decide))
  have two : 2^96 = B*B := by decide
  have three : 2^144 = B*B*B := by decide
  simp only [wordBitRange,show (48==0)=false by decide,if_false,Bool.false_eq_true,Nat.pow_zero,Nat.div_one,normal]
  simp only [two,three,←Nat.div_div_eq_div_mul,Digits.pack,step,Nat.add_mul_mod_self_left,Nat.mod_eq_of_lt x.a.isLt,
    Nat.mod_eq_of_lt x.b.isLt,Nat.mod_eq_of_lt x.c.isLt,Nat.mod_eq_of_lt x.d.isLt,small,true_and,and_self]

end Inv08.Packed
