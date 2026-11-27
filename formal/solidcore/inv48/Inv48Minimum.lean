import Inv03Budget
namespace Inv48

def minimum (collateral rep price : Nat) :=
  max collateral (Inv03.ceilQuot (rep * 10^18) price)

theorem sufficient (c r p a : Nat) (positive : 0 < p) :
    minimum c r p ≤ a ↔ c ≤ a ∧ r * 10^18 ≤ a * p := by
  rw [minimum,Nat.max_le,Inv03.ceil_le _ _ _ positive]

theorem monotonePrice (c r p q : Nat) (positive : 0 < p) (rise : p ≤ q) :
    minimum c r q ≤ minimum c r p := by
  obtain ⟨floor,backed⟩ := (sufficient c r p _ positive).mp (Nat.le_refl _)
  exact (sufficient c r q _ (Nat.lt_of_lt_of_le positive rise)).mpr
    ⟨floor,Nat.le_trans backed (Nat.mul_le_mul_left _ rise)⟩

theorem initialRep (collateral price amount : Nat) :
    Inv03.ceilQuot (collateral * price) (10^18) ≤ amount ↔ collateral * price ≤ amount * 10^18 :=
  Inv03.ceil_le _ _ _ (by decide)
#print axioms sufficient
#print axioms monotonePrice
#print axioms initialRep
end Inv48
