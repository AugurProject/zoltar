import Inv48LiquidationGuardRecovery
namespace GuardRecovery
/-- The mathematical obligation to discharge after identifying the recovered
library return. This is an equivalence, not an extra success assumption. -/
theorem liquidationPositiveIff (price uncertainty : Nat) :
    0 < price * 10000000 / (10000000 + uncertainty) ↔
      10000000 + uncertainty ≤ price * 10000000 := by
  rw [Nat.div_pos_iff]
  omega

/-- Positive price alone misses the rounding-to-zero boundary. -/
theorem priceOneBoundary (uncertainty : Nat) :
    0 < 10000000 / (10000000 + uncertainty) ↔ uncertainty = 0 := by
  rw [Nat.div_pos_iff]
  omega
#print axioms liquidationPositiveIff
#print axioms priceOneBoundary
end GuardRecovery
