import Inv39SpendBranch
import Inv39Ledger
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
/-- Only the allowance actually addressed by the call needs to be separated from accounting words. -/
structure Separate (A : Nat → Prop) (o sp : Nat) : Prop where
  balances : ∀ a, A a → Shared.norm (slot o sp)≠Shared.norm (balanceSlot a)
  issued : Shared.norm (slot o sp)≠Shared.norm circulating.slot
  ceiling : Shared.norm (slot o sp)≠Shared.norm theoretical.slot
theorem framed (s : State) (A : Nat → Prop) (b : Balances) (o sp old v : Nat) (original : Books A s b)
    (separate : old<R-1 → Separate A o sp) :
    Books A (afterSpend s o sp old v) b ∧ (afterSpend s o sp old v).loadSlot theoretical.slot=s.loadSlot theoretical.slot := by
  unfold afterSpend
  split
  · rename_i finite
    have sep := separate finite
    exact ⟨⟨writeOutsideBalances _ _ _ _ _ _ original.balances sep.balances,(loadUnchanged _ _ _ _ sep.issued).trans original.issued⟩,loadUnchanged _ _ _ _ sep.ceiling⟩
  · exact ⟨original,rfl⟩
end Inv39.Allowance
