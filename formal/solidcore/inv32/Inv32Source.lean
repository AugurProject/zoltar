import Inv32Generated

open SolidCore.Solidity
namespace Inv32Source
inductive Outcome where
  | returned (amount fee : Nat)
  | reverted
  | failed
  deriving DecidableEq

def quote (name : String) (x y amount fee : Nat) : Outcome := Id.run do
  let .ok c := TypeCheck.CheckedInput.contract Inv32Generated.importedSourceUnit "TwoWayConstantProductMathHarness" | return .failed
  match TypeCheck.CheckedContract.call 50000 c (.name name) Source.State.empty
    ([x,y,amount,fee].map fun n => .word n) with
  | .ok (.returned _ [.word a, .word f]) => return .returned a f
  | .ok (.reverted _ _) => return .reverted
  | _ => return .failed

def leastSufficient (x y target fee gross : Nat) : Prop :=
  (∃ f, quote "quoteExactOutput" x y target fee = .returned gross f) ∧
  (∃ out f, quote "quoteExactInput" x y gross fee = .returned out f ∧ target ≤ out) ∧
  ∀ smaller, smaller < gross →
    quote "quoteExactInput" x y smaller fee = .reverted ∨
    ∃ out f, quote "quoteExactInput" x y smaller fee = .returned out f ∧ out < target

theorem overshoot : leastSufficient 1 4 1 0 1 := by
  refine ⟨⟨0, by native_decide⟩, ⟨2, 0, by native_decide, by decide⟩, ?_⟩
  intro smaller below
  have : smaller = 0 := by omega
  subst smaller
  exact Or.inl (by native_decide)

-- At reserves (3, 10) and a 10% fee, a target of 4 requires
-- two net input units and three gross units.
theorem roundedFee : leastSufficient 3 10 4 1000 3 := by
  refine ⟨⟨1, by native_decide⟩, ⟨4, 1, by native_decide, by decide⟩, ?_⟩
  intro smaller below
  have : smaller = 0 ∨ smaller = 1 ∨ smaller = 2 := by omega
  rcases this with rfl | rfl | rfl
  · exact Or.inl (by native_decide)
  · exact Or.inl (by native_decide)
  · exact Or.inr ⟨2, 1, by native_decide, by decide⟩

-- The true sum of the reserves and net input is wider than a word.
theorem wideDenominatorBoundary :
    let m := 2^256 - 1
    quote "quoteExactOutput" m 4 2 0 = .returned m 0 ∧
    quote "quoteExactInput" m 4 m 0 = .returned 2 0 ∧
    quote "quoteExactInput" m 4 (m-1) 0 = .returned 1 0 := by native_decide

end Inv32Source

/- INV-32. All amounts are raw units. Naturals model full-precision intermediate
   products; the quote wrappers below enforce the successful uint256 domain. -/
namespace Inv32

abbrev word : Nat := 2^256

-- Give the linear arithmetic solver a numeral for the limb radix.
private theorem word_value : word = 115792089237316195423570985008687907853269984665640564039457584007913129639936 := by decide
abbrev bps : Nat := 10000
def ceilDiv (n d : Nat) := (n + d - 1) / d

theorem ceil_le {n d k : Nat} (hd : 0 < d) : ceilDiv n d ≤ k ↔ n ≤ k*d := by
  unfold ceilDiv
  rw [Nat.div_le_iff_le_mul hd]
  omega

-- The arguments are the three products returned as (high,low) by Math.mul512.
def limbCompare (a b r : Nat) : Bool :=
  let lo := (a % word + b % word) % word
  let carry := if lo < a % word then 1 else 0
  let hi := (a / word + b / word) % word
  let total := (hi + carry) % word
  if hi < a / word then false else if total < hi then false else
    total < r / word || (total == r / word && lo ≤ r % word)

private theorem addWord {a b : Nat} (ha : a < word) (hb : b < word) :
    (a+b)%word + word*(if (a+b)%word < a then 1 else 0) = a+b := by
  by_cases h : a+b < word
  · rw [Nat.mod_eq_of_lt h, if_neg (by omega)]
    simp
  · have small : a+b-word < word := by omega
    rw [Nat.mod_eq_sub_mod (by omega), Nat.mod_eq_of_lt small, if_pos (by omega)]
    simp
    omega

theorem limbCompare_correct (a b r : Nat) (ha : a < word*word)
    (hb : b < word*word) (hr : r < word*word) :
    limbCompare a b r = true ↔ a+b ≤ r := by
  have w : 0 < word := by decide
  have la := addWord (Nat.mod_lt a w) (Nat.mod_lt b w)
  have ah := (Nat.div_lt_iff_lt_mul w).mpr ha
  have bh := (Nat.div_lt_iff_lt_mul w).mpr hb
  have hh := addWord ah bh
  let carry := if (a%word+b%word)%word < a%word then 1 else 0
  have hc : carry < word := by dsimp [carry]; split <;> decide
  have total := addWord (Nat.mod_lt (a/word+b/word) w) hc
  dsimp [carry] at total
  unfold limbCompare
  by_cases low : (a%word+b%word)%word < a%word <;>
    by_cases high : (a/word+b/word)%word < a/word <;>
    simp only [low, high, if_true, if_false, ↓reduceIte] at * <;>
    (repeat' split at *) <;>
    simp only [Bool.false_eq_true, false_iff, Bool.or_eq_true, Bool.and_eq_true,
      beq_iff_eq, decide_eq_true_eq, word_value] at * <;> omega

def search (test : Nat → Bool) (lo hi : Nat) : Nat :=
  if h : lo < hi then
    let mid := lo + (hi-lo)/2 + 1
    if test mid then search test mid hi else search test lo (mid-1)
  else lo
termination_by hi-lo
decreasing_by all_goals omega

theorem search_correct (test : Nat → Bool) (bound answer lo hi : Nat)
    (spec : ∀ k, k ≤ bound → (test k = true ↔ k ≤ answer)) (hl : lo ≤ answer) (hh : answer ≤ hi) (hb : hi ≤ bound) :
    search test lo hi = answer := by
  induction lo, hi using search.induct test with
  | case1 lo hi h mid yes ih =>
    rw [search, dif_pos h, if_pos yes]
    exact ih ((spec mid (by dsimp [mid]; omega)).mp yes) hh hb
  | case2 lo hi h mid no ih =>
    have above : answer < mid := by
      apply Nat.lt_of_not_ge
      intro le
      exact no ((spec mid (by dsimp [mid]; omega)).mpr le)
    rw [search, dif_pos h, if_neg no]
    exact ih hl (by omega) (by dsimp [mid]; omega)
  | case3 lo hi h => rw [search, dif_neg h]; omega

def ratio (scale part other : Nat) : Nat :=
  if other ≤ word-1-part then scale*part/(other+part)
  else search (fun k => limbCompare (k*other) (k*part) (scale*part)) 0 scale

theorem ratio_correct (scale part other : Nat)
    (hs : scale < word) (hp : part < word) (ho : other < word) (hd : 0 < other+part) :
    ratio scale part other = scale*part/(other+part) := by
  unfold ratio
  split
  · rfl
  · have product {a b : Nat} (aSmall : a < word) (bSmall : b < word) :
          a*b < word*word :=
        Nat.lt_of_le_of_lt (Nat.mul_le_mul_right b (Nat.le_of_lt aSmall))
          (Nat.mul_lt_mul_of_pos_left bSmall (by decide))
    apply search_correct _ scale
    · intro k hk
      rw [limbCompare_correct _ _ _ (product (Nat.lt_of_le_of_lt hk hs) ho)
        (product (Nat.lt_of_le_of_lt hk hs) hp) (product hs hp), Nat.le_div_iff_mul_le hd,
        Nat.mul_add]
    · exact Nat.zero_le _
    · apply (Nat.div_le_iff_le_mul hd).mpr
      have := Nat.mul_le_mul_left scale (Nat.le_add_left part other)
      omega
    · exact Nat.le_refl _

def netInput (gross fee : Nat) := gross*(bps-fee)/bps

def requiredNet (x y target : Nat) := ceilDiv (x*target) (y-target)

def cost (x y target fee : Nat) := ceilDiv (requiredNet x y target*bps) (bps-fee)

-- Successful exact-output calls require both rounded mulDiv results to fit.
def quoteExactOutput (x y target fee : Nat) : Option Nat :=
  if 0 < x ∧ 0 < target ∧ target < y ∧ fee < bps ∧
      requiredNet x y target < word ∧ cost x y target fee < word
    then some (cost x y target fee) else none

def quoteExactInput (x y gross fee : Nat) : Option Nat :=
  let n := netInput gross fee
  let out := ratio y n x
  if 0 < x ∧ 0 < y ∧ 0 < gross ∧ fee < bps ∧ 0 < n ∧ 0 < out ∧ out < y
    then some out else none

private theorem net_le (g f : Nat) : netInput g f ≤ g := by
  apply (Nat.div_le_iff_le_mul (by decide : 0 < bps)).mpr
  have := Nat.mul_le_mul_left g (Nat.sub_le bps f)
  have : 0 < bps := by decide
  omega

private theorem threshold (x y t g f : Nat) (hx : 0 < x) (ht : t < y) (hf : f < bps) :
    cost x y t f ≤ g ↔ t ≤ y*netInput g f/(x+netInput g f) := by
  unfold cost requiredNet
  rw [ceil_le (by omega), ← Nat.le_div_iff_mul_le (by decide : 0 < bps),
    ceil_le (by omega), Nat.le_div_iff_mul_le (by omega), Nat.mul_add,
    Nat.mul_comm t x, Nat.mul_comm t (netInput g f), Nat.mul_comm y (netInput g f)]
  change x*t ≤ netInput g f*(y-t) ↔ _
  rw [Nat.mul_sub]
  have := Nat.mul_le_mul_left (netInput g f) (Nat.le_of_lt ht)
  omega

/-- For unchanged uint256 reserves, a successful inverse quote is precisely the
    threshold among all uint256 forward inputs, including inputs that revert. -/
theorem minimumGrossInput (x y target fee quoted gross : Nat)
    (hx : x < word) (hy : y < word) (hg : gross < word)
    (inverse : quoteExactOutput x y target fee = some quoted) :
    quoted ≤ gross ↔ ∃ out, quoteExactInput x y gross fee = some out ∧ target ≤ out := by
  unfold quoteExactOutput at inverse
  split at inverse <;> simp only [Option.some.injEq, reduceCtorEq] at inverse
  next valid =>
    obtain ⟨xPos,tPos,ty,feeBound,_,_⟩ := valid
    subst quoted
    let n := netInput gross fee
    have ng : n ≤ gross := net_le _ _
    have denom : 0 < x+n := by omega
    have ratioEq := ratio_correct y n x hy (Nat.lt_of_le_of_lt ng hg) hx denom
    have below : y*n/(x+n) < y := by
      apply (Nat.div_lt_iff_lt_mul denom).mpr
      rw [Nat.mul_add]
      have := Nat.mul_pos (Nat.lt_trans tPos ty) xPos
      omega
    rw [threshold _ _ _ _ _ xPos ty feeBound]
    change target ≤ y*n/(x+n) ↔ _
    unfold quoteExactInput
    change _ ↔ ∃ out, (if 0 < x ∧ 0 < y ∧ 0 < gross ∧ fee < bps ∧ 0 < n ∧
      0 < ratio y n x ∧ ratio y n x < y then some (ratio y n x) else none) = some out ∧ _
    rw [ratioEq]
    constructor
    · intro meets
      have np : 0 < n := by
        apply Nat.pos_of_ne_zero
        intro zero
        simp [zero] at meets
        omega
      rw [if_pos (by exact ⟨xPos, by omega, by omega, feeBound, np, by omega, below⟩)]
      exact ⟨_, rfl, meets⟩
    · rintro ⟨out,success,enough⟩
      split at success <;> simp_all
-- The inverse quote can return its fee field without checked subtraction reverting.
theorem inverseNetLeGross (x y t f : Nat) (hf : f < bps) :
    requiredNet x y t ≤ cost x y t f := by
  have h := (ceil_le (n := requiredNet x y t*bps) (d := bps-f)
    (k := cost x y t f) (by omega)).mp (Nat.le_refl _)
  have upper := Nat.mul_le_mul_left (cost x y t f) (Nat.sub_le bps f)
  exact Nat.le_of_mul_le_mul_right (Nat.le_trans h upper) (by decide)

-- Concrete witnesses exercise overshoot, the wide denominator, and inverse overflow.
example : quoteExactOutput 1 4 1 0 = some 1 ∧ quoteExactInput 1 4 1 0 = some 2 := by decide
example : quoteExactOutput (word-1) 4 2 0 = some (word-1) ∧
    quoteExactInput (word-1) 4 (word-1) 0 = some 2 := by
  constructor
  · decide
  · unfold quoteExactInput
    dsimp only
    rw [ratio_correct 4 (netInput (word-1) 0) (word-1) (by decide) (by decide) (by decide) (by decide)]
    decide
example : quoteExactOutput (word-1) 3 2 0 = none := by decide

end Inv32

namespace Inv32Source
/-- Observable quote success, including the two return words. -/
def returnsAmount (method : String) (x y a fee amount : Nat) : Prop :=
  ∃ paid, quote method x y a fee = .returned amount paid

/-- The two public source refinements discharged by Inv32Proved. -/
def ForwardRefines : Prop := ∀ x y g fee out,
  x < Inv32.word → y < Inv32.word → g < Inv32.word → fee < Inv32.word →
  (returnsAmount "quoteExactInput" x y g fee out ↔ Inv32.quoteExactInput x y g fee = some out)

def InverseSound : Prop := ∀ x y t fee q,
  x < Inv32.word → y < Inv32.word → t < Inv32.word → fee < Inv32.word →
  returnsAmount "quoteExactOutput" x y t fee q → Inv32.quoteExactOutput x y t fee = some q

theorem minimumGrossInput_of_refinement (forward : ForwardRefines) (inverse : InverseSound)
    (x y t fee q g : Nat) (hx : x < Inv32.word) (hy : y < Inv32.word)
    (ht : t < Inv32.word) (hf : fee < Inv32.word) (hg : g < Inv32.word)
    (returned : returnsAmount "quoteExactOutput" x y t fee q) :
    q ≤ g ↔ ∃ out, returnsAmount "quoteExactInput" x y g fee out ∧ t ≤ out := by
  simp only [forward x y g fee _ hx hy hg hf]
  exact Inv32.minimumGrossInput _ _ _ _ _ _ hx hy hg (inverse x y t fee q hx hy ht hf returned)
end Inv32Source
