import Inv44Model
namespace Inv44
/-- Mask after scanning the first n configured slots in this read. -/
def mask (present : Nat → Bool) : Nat → Nat
  | 0 => 0
  | n+1 => if present n then mask present n ||| 2^n else mask present n

theorem bit (present : Nat → Bool) (n i : Nat) : (mask present n).testBit i = (decide (i<n) && present i) := by
  induction n with
  | zero => simp [mask]
  | succ n ih =>
    by_cases eq : n=i
    · subst i; cases h : present n <;> simp [mask,h,ih,Nat.testBit_or]
    · have lt : (i<n+1) ↔ i<n := by omega
      cases h : present n <;> simp [mask,h,ih,Nat.testBit_or,eq,lt]

theorem fits (present : Nat → Bool) (n : Nat) : mask present n<2^n := by
  induction n with
  | zero => simp [mask]
  | succ n ih =>
    have le : 2^n≤2^(n+1) := Nat.pow_le_pow_right (by decide) (Nat.le_succ _)
    cases h : present n
    · simp [mask,h]; exact ih.trans_le le
    · rw [mask,if_pos h]
      exact Nat.or_lt_two_pow (ih.trans_le le) (Nat.pow_lt_pow_right (by decide) (Nat.lt_succ_self _))

theorem duplicate (present : Nat → Bool) (n i j : Nat) (a : i<n) (b : j<n) (same : present i=present j) :
    (mask present n).testBit i=(mask present n).testBit j := by simp [bit,a,b,same]

end Inv44
