import Lean
namespace Inv03
def ceilQuot (amount denominator : Nat) := (amount + (denominator - 1)) / denominator

theorem ceil_le (a d k : Nat) (hd : 0<d) : ceilQuot a d ≤ k ↔ a ≤ k*d := by
  unfold ceilQuot
  rw [Nat.div_le_iff_le_mul_add_pred hd,Nat.mul_comm d k]
  omega

/-- The raw-value conversion in SettlementMath rounds down at a fixed book price. -/
def rawValue (weight net total : Nat) := weight*net/(total*10^9)
def reserve (cash total net : Nat) := ceilQuot (cash*(total*10^9)) net

theorem funded_iff (q cash net total : Nat) (hn : 0<net) (ht : 0<total) :
    cash ≤ rawValue q net total ↔ reserve cash total net ≤ q := by
  unfold rawValue reserve
  rw [Nat.le_div_iff_mul_le (Nat.mul_pos ht (by decide)),ceil_le _ _ _ hn]

/-- This budget is zero whenever the current units cannot support the cash floor. -/
def budget (q cash net total : Nat) :=
  if cash > rawValue q net total then 0 else q - reserve cash total net

theorem maximal (q supply rate net total : Nat) (hn : 0<net) (ht : 0<total) :
    let cash := ceilQuot (supply*rate) (10^18)
    let b := budget q cash net total
    (cash ≤ rawValue q net total →
      b≤q ∧ ∀ removed, removed≤q → (cash ≤ rawValue (q-removed) net total ↔ removed≤b)) ∧
    (rawValue q net total < cash → b=0) := by
  dsimp only
  constructor
  · intro ok
    have r := (funded_iff q _ net total hn ht).mp ok
    rw [budget,if_neg (Nat.not_lt.mpr ok)]
    refine ⟨Nat.sub_le _ _,?_⟩
    intro removed fits
    rw [funded_iff _ _ _ _ hn ht]
    omega
  · intro low
    simp [budget,low]
/-- The settlement book limits units below 2^128 and minimumRate to 10^18.
For funded questions the computed reserve in units cannot exceed the question's own weight. -/
theorem wordBounds (q supply rate net total : Nat) (rateOK : rate≤10^18) (word : supply<2^256)
    (ht : 0<total) (totalBound : total<2^128) (hn : 0<net) (qBound : q≤total) (netBound : net<2^256) :
    let cash := ceilQuot (supply*rate) (10^18)
    cash<2^256 ∧ total*10^9<2^256 ∧ rawValue q net total<2^256 ∧
    (cash≤rawValue q net total → reserve cash total net<2^256) := by
  dsimp only
  have cashBound := (ceil_le (supply*rate) (10^18) supply (by decide)).mpr (Nat.mul_le_mul_left supply rateOK)
  have dBound := Nat.mul_le_mul_right (10^9) (Nat.le_of_lt totalBound)
  have rawBound : rawValue q net total ≤ net := by
    unfold rawValue
    apply Nat.div_le_of_le_mul
    rw [Nat.mul_comm (total*10^9) net,Nat.mul_comm q net]
    exact Nat.mul_le_mul_left net (Nat.le_trans qBound (Nat.le_mul_of_pos_right _ (by decide)))
  exact ⟨Nat.lt_of_le_of_lt cashBound word,Nat.lt_of_le_of_lt dBound (by decide),Nat.lt_of_le_of_lt rawBound netBound,
    fun h => Nat.lt_of_le_of_lt ((funded_iff _ _ _ _ hn ht).mp h)
      (Nat.lt_of_le_of_lt qBound (Nat.lt_trans totalBound (by decide)))⟩
end Inv03
