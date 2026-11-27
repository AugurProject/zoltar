import Inv45Arithmetic
namespace Inv45.Answer
abbrev radix : Nat := 2^120
def encode (n k : Nat) := 2^255 + (n-k)*radix + k
theorem lowBound (n k : Nat) (fits : n<radix) (valid : k≤n) : (n-k)*radix+k < 2^240 := by
  have left := Nat.mul_le_mul_right radix (show n-k≤radix-1 by omega)
  norm_num [radix] at *;omega
theorem fit (n k : Nat) (fits : n<radix) (valid : k≤n) : encode n k<2^256 := by
  have := lowBound n k fits valid;unfold encode;norm_num at *;omega
theorem high (n k : Nat) (fits : n<radix) (valid : k≤n) : encode n k >>> 255 = 1 := by
  have := lowBound n k fits valid
  rw [Nat.shiftRight_eq_div_pow];unfold encode;norm_num at *;omega
theorem decompose (n k : Nat) : encode n k=radix*(2^135+(n-k))+k := by
  unfold encode;rw [Nat.mul_add, Nat.mul_comm radix (n-k)];rfl
theorem low (n k : Nat) (fits : n<radix) (valid : k≤n) : encode n k &&& (2^120-1) = k := by
  rw [Nat.and_two_pow_sub_one_eq_mod,decompose,Nat.mul_add_mod,Nat.mod_eq_of_lt (lt_of_le_of_lt valid fits)]
theorem midpoint (n k : Nat) (fits : n<radix) (valid : k≤n) :
    (encode n k >>> 120) &&& (2^120-1) = n-k := by
  rw [Nat.shiftRight_eq_div_pow, Nat.and_two_pow_sub_one_eq_mod,decompose,Nat.mul_add_div (by decide),
    Nat.div_eq_of_lt (lt_of_le_of_lt valid fits),Nat.add_zero]
  change (radix*2^15 + (n-k)) % radix=_
  rw [Nat.mul_add_mod,Nat.mod_eq_of_lt (by omega)]
theorem reserved (n k : Nat) (fits : n<radix) (valid : k≤n) :
    encode n k &&& ((2^15-1) <<< 240) = 0 := by
  have h := lowBound n k fits valid
  have quotient : encode n k >>> 240 = 2^15 := by
    rw [Nat.shiftRight_eq_div_pow]; unfold encode;norm_num at *;omega
  apply Nat.eq_of_testBit_eq
  intro j
  rw [Nat.testBit_and,Nat.testBit_shiftLeft,Nat.testBit_two_pow_sub_one]
  rw [Nat.zero_testBit]
  by_cases small : j<240
  · simp [show ¬j≥240 by omega]
  · have bound : 240 ≤ j := by omega
    have eq := congrArg (fun x : Nat => x.testBit (j-240)) quotient
    dsimp only at eq
    rw [Nat.testBit_shiftRight, show 240+(j-240)=j by omega] at eq
    rw [eq]
    rw [Nat.testBit_two_pow]; by_cases y : 15=j-240 <;> simp [y] <;> omega
end Inv45.Answer
