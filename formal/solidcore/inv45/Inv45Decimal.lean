import Inv45Interpolation
namespace Inv45.Decimal
/-- Decimal digits in least significant first order, with zero encoded by the Solidity early return. -/
def reversed (n : Nat) : List Nat :=
  if h : n=0 then [] else (48+n%10)::reversed (n/10)
termination_by n
decreasing_by exact Nat.div_lt_self (Nat.pos_of_ne_zero h) (by decide)
def decimal (n : Nat) : List Nat := if n=0 then [48] else (reversed n).reverse
def unroll : List Nat → Nat | []=>0 | d::rest=> d-48+10*unroll rest
theorem reconstruct (n : Nat) : unroll (reversed n)=n := by
  induction n using Nat.strong_induction_on with
  | h n ih =>
    rw [reversed];split
    · subst n;rfl
    · rename_i nz
      rw [unroll,ih _ (Nat.div_lt_self (Nat.pos_of_ne_zero nz) (by decide))]
      have := Nat.div_add_mod n 10
      omega
theorem readDecimal (n : Nat) : unroll (decimal n).reverse=n := by
  by_cases zero : n=0
  · subst n;rfl
  · simp only [decimal,if_neg zero,List.reverse_reverse,reconstruct]
theorem injective : Function.Injective decimal := by
  intro a b h;have eq := congrArg (fun xs : List Nat => unroll xs.reverse) h
  simpa only [readDecimal] using eq
theorem digitBounds {n ch : Nat} (m : ch∈reversed n) : 48≤ch ∧ ch<58 := by
  induction n using Nat.strong_induction_on with
  | h n ih =>
    rw [reversed] at m;split at m
    · contradiction
    · rename_i nz;rcases List.mem_cons.mp m with val|tail
      · have h := Nat.mod_lt n (by decide : 0<10);omega
      · exact ih _ (Nat.div_lt_self (Nat.pos_of_ne_zero nz) (by decide)) tail
theorem decimalDigits {n ch : Nat} (m : ch∈decimal n) : 48≤ch ∧ ch<58 := by
  unfold decimal at m;split at m
  · simp only [List.mem_singleton] at m;omega
  · exact digitBounds (List.mem_reverse.mp m)
theorem lengthBound (n : Nat) : n < 10^k → (reversed n).length≤k := by
  induction k generalizing n with
  | zero => intro h; have z : n=0 := by simpa using h
            subst n;native_decide
  | succ k ih =>
    intro h;rw [reversed];split
    · simp
    · have b : n/10 < 10^k := (Nat.div_lt_iff_lt_mul (by decide)).mpr (by simpa only [Nat.pow_succ] using h)
      exact Nat.succ_le_succ (ih _ b)
theorem nonempty (n : Nat) : decimal n≠[] := by
  intro empty
  have d := readDecimal n
  rw [empty] at d
  change 0=n at d
  subst n
  exact (by decide : decimal 0≠[]) empty
end Inv45.Decimal
