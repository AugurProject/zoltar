import Inv12Allocation
open Inv32Division
namespace Inv12

theorem assignedLeCash (cash total : Nat) (branches : List Nat) (pos : 0<total) (bound : branches.sum≤total) :
    assigned cash total branches≤cash := by
  have ledger := divisionLedger cash total branches
  apply Nat.le_of_mul_le_mul_right _ pos
  calc
    assigned cash total branches*total ≤ assigned cash total branches*total+remainders cash total branches := Nat.le_add_right _ _
    _ = cash*branches.sum := ledger
    _ ≤ cash*total := Nat.mul_le_mul_left cash bound

theorem choiceWords (cash total old extra : Nat) (before after : List Nat) (word : cash<R) (tw : total<R)
    (pos : 0<total) (remaining : (before++[old+extra]++after).sum≤total) :
    old+extra<R ∧ cash*(old+extra)/total<R ∧ cash*old/total≤cash*(old+extra)/total ∧
    assigned cash total (before++[old]++after)+(cash*(old+extra)/total-cash*old/total)<R := by
  have bound : old+extra≤total := by
    simp only [List.sum_append,List.sum_cons,List.sum_nil,Nat.add_zero] at remaining
    omega
  refine ⟨lt_of_le_of_lt bound tw,branchFits _ _ _ word bound, Nat.div_le_div_right
    (Nat.mul_le_mul_left _ (Nat.le_add_right _ _)),?_⟩
  rw [←replaceBranch]
  exact lt_of_le_of_lt (assignedLeCash _ _ _ pos remaining) word
end Inv12
