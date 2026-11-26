import Inv45DecimalCall
open Inv45.Decimal
namespace Inv45.Text
abbrev base : Nat := 10^18
def pad (xs : List Nat) := List.replicate (18-xs.length) 48 ++ xs
def strip (xs : List Nat) := (xs.reverse.dropWhile (·==48)).reverse
def numeric (n : Nat) := decimal (n/base) ++ if n%base=0 then [] else 46::strip (pad (decimal (n%base)))
def signed (v : Int) := if v<0 then 45::numeric v.natAbs else numeric v.natAbs
def suffix (n : Nat) : Option Nat→List Nat
  | none=>[]
  | some k=>[32,40,116,105,99,107,32]++decimal k++[32,111,102,32]++decimal n++[41]
def unitBytes (xs : List Nat) := if xs=[] then [] else 32::xs
def label (v : Int) (unit : List Nat) (n : Nat) (tick : Option Nat) := signed v++(unitBytes unit++suffix n tick)
def read (xs : List Nat) := unroll xs.reverse
def isDigit (ch : Nat) := decide (48≤ch ∧ ch<58)
theorem allDigits (n : Nat) : ∀ch∈decimal n,isDigit ch=true := by
  intro ch inside;exact decide_eq_true (decimalDigits inside)
theorem readDigits (n : Nat) : read (decimal n)=n := readDecimal n
theorem readZeroPrefix (k : Nat) (xs : List Nat) : read (List.replicate k 48 ++ xs)=read xs := by
  have appendZero (ys : List Nat) : unroll (ys++List.replicate k 48)=unroll ys := by
    induction ys with
    | nil => induction k with | zero=>rfl | succ k ih=>simp [List.replicate_succ,unroll] at *;omega
    | cons y ys ih => simp only [List.cons_append,unroll,ih]
  simpa only [read,List.reverse_append,List.reverse_replicate] using appendZero xs.reverse
theorem dropRebuild (xs : List Nat) : ∃ k, xs=List.replicate k 48++xs.dropWhile (·==48) := by
  induction xs with
  | nil => exact ⟨0,rfl⟩
  | cons x xs ih =>
    by_cases z : x=48
    · subst x; obtain ⟨k,h⟩ := ih
      exact ⟨k+1,by simp only [List.replicate_succ,List.cons_append,List.dropWhile_cons_of_pos (by decide : (48:Nat)==48)];exact congrArg (48::·) h⟩
    · exact ⟨0,by simp [List.dropWhile_cons,z]⟩
theorem restore (xs : List Nat) : strip xs ++ List.replicate (xs.length-(strip xs).length) 48=xs := by
  obtain ⟨k,h⟩ := dropRebuild xs.reverse
  have rep := congrArg List.reverse h
  simp only [List.reverse_reverse,List.reverse_append,List.reverse_replicate] at rep
  change xs=strip xs++List.replicate k 48 at rep
  have length := congrArg List.length rep
  simp only [List.length_append,List.length_replicate] at length
  rw [show xs.length-(strip xs).length=k by omega,←rep]
theorem decimalLength (n : Nat) (less : n<base) : (decimal n).length≤18 := by
  by_cases z : n=0
  · subst n;decide
  · simp only [decimal,if_neg z,List.length_reverse];exact lengthBound n less
theorem readFraction (n : Nat) (less : n<base) :
    let out := strip (pad (decimal n))
    read (out ++ List.replicate (18-out.length) 48)=n := by
  have length : (pad (decimal n)).length=18 := by
    simp only [pad,List.length_append,List.length_replicate];have := decimalLength _ less;omega
  have eq := restore (pad (decimal n));rw [length] at eq
  dsimp only;rw [eq,pad,readZeroPrefix,readDigits]
def readFixed (xs : List Nat) := let whole := xs.takeWhile isDigit
  let part := (xs.dropWhile isDigit).drop 1
  read whole*base + read (part++List.replicate (18-part.length) 48)
theorem readNumeric (n : Nat) : readFixed (numeric n)=n := by
  let a := decimal (n/base)
  have digits := allDigits (n/base)
  have eq := Nat.div_add_mod n base
  unfold numeric readFixed
  rw [List.takeWhile_append_of_pos digits,List.dropWhile_append_of_pos digits]
  by_cases whole : n%base=0
  · simp only [if_pos whole,List.takeWhile_nil,List.dropWhile_nil,List.drop_nil,List.length_nil,
      Nat.sub_zero,List.nil_append,List.append_nil,readDigits]
    have z : read (List.replicate 18 48)=0 := by decide
    rw [z,Nat.mul_comm (n/base) base];omega
  · let f := strip (pad (decimal (n%base)))
    have stop : ¬isDigit 46=true := by decide
    simp only [if_neg whole,List.takeWhile_cons_of_neg stop,List.dropWhile_cons_of_neg stop,List.append_nil,
      List.drop_succ_cons,List.drop_zero,readDigits]
    rw [readFraction (n%base) (Nat.mod_lt n (by decide))];rw [Nat.mul_comm]
    exact eq
theorem allowed (n : Nat) : ∀ch∈numeric n,46=ch ∨ (48≤ch ∧ ch<58) := by
  intro ch mem;unfold numeric at mem
  rcases List.mem_append.mp mem with d|f
  · exact .inr (decimalDigits d)
  · split at f
    · contradiction
    · rcases List.mem_cons.mp f with dot|inside
      · exact .inl dot.symm
      · have restore' := restore (pad (decimal (n%base)))
        have h : ch∈pad (decimal (n%base)) := restore' ▸ List.mem_append_left _ inside
        rcases List.mem_append.mp h with zero|digit
        · have := List.eq_of_mem_replicate zero;omega
        · exact .inr (decimalDigits digit)
theorem numericInjective : Function.Injective numeric := by
  intro a b same;simpa only [readNumeric] using congrArg readFixed same
end Inv45.Text
