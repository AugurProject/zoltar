import Inv39Balances
import Inv39Slots
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
/-- Restrict the address/slot relation to accounts admitted by the trace. -/
def Represents (accounts : Nat → Prop) (loc : Nat → Nat) (s : State) (b : Balances) :=
  ∀ a, accounts a → s.loadSlot (loc a) = balance a b
theorem setRepresents (accounts : Nat → Prop) (loc : Nat → Nat) (s : State) (b : Balances)
    (who value : Nat) (seen : accounts who) (fits : value < R)
    (separate : ∀ a a', accounts a → accounts a' → Shared.norm (loc a) = Shared.norm (loc a') → a=a')
    (before : Represents accounts loc s b) :
    Represents accounts loc (s.storeSlot (loc who) value) (setBalance who value b) := by
  intro a belongs
  rw [loadAfterWrite,balanceSet]
  by_cases same : a=who
  · subst a; simp [show Shared.norm value = value from Nat.mod_eq_of_lt fits]
  · have diff : Shared.norm (loc who) ≠ Shared.norm (loc a) := fun h => same (separate _ _ seen belongs h).symm
    simp [same,diff,before a belongs]
theorem writeOutsideBalances (accounts : Nat → Prop) (loc : Nat → Nat) (s : State) (b : Balances) (slot value : Nat)
    (before : Represents accounts loc s b)
    (separate : ∀ a, accounts a → Shared.norm slot ≠ Shared.norm (loc a)) :
    Represents accounts loc (s.storeSlot slot value) b := by
  intro a ha
  rw [loadUnchanged _ _ _ _ (separate a ha),before _ ha]
end Inv39
