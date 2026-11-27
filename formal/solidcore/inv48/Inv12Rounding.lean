import Inv32Division
namespace Inv12

def assigned (cash total : Nat) (choices : List Nat) := (choices.map (fun k => cash*k/total)).sum
def remainders (cash total : Nat) (choices : List Nat) := (choices.map (fun k => cash*k%total)).sum

theorem divisionLedger (cash total : Nat) (choices : List Nat) :
    assigned cash total choices * total + remainders cash total choices = cash * choices.sum := by
  induction choices with
  | nil => simp [assigned,remainders]
  | cons k ks ih =>
    change (cash*k/total+assigned cash total ks)*total+(cash*k%total+remainders cash total ks) = cash*(k+ks.sum)
    have div := Nat.mod_add_div (cash*k) total
    rw [Nat.add_mul,Nat.mul_add,Nat.mul_comm (cash*k/total) total]
    omega

theorem residueBound (cash total : Nat) (choices : List Nat) (positive : 0<total) :
    remainders cash total choices ≤ choices.length*(total-1) := by
  induction choices with
  | nil => simp [remainders]
  | cons k ks ih =>
    change cash*k%total+remainders cash total ks ≤ (ks.length+1)*(total-1)
    have rem := Nat.mod_lt (cash*k) positive
    rw [Nat.add_mul,Nat.one_mul]
    omega

/-- Full commitment coverage bounds unassigned cash by one less than the branch count. -/
theorem roundedAllocation (cash total : Nat) (choices : List Nat) (positive : 0<total)
    (allChosen : choices.sum=total) :
    assigned cash total choices≤cash ∧ cash-assigned cash total choices<choices.length := by
  have exactSum := divisionLedger cash total choices
  rw [allChosen] at exactSum
  have le : assigned cash total choices≤cash :=
    Nat.le_of_mul_le_mul_right (exactSum ▸ Nat.le_add_right _ _) positive
  have gap : (cash-assigned cash total choices)*total=remainders cash total choices := by
    rw [Nat.sub_mul]; omega
  have nonempty : 0<choices.length := by cases choices <;> simp_all
  have upper := residueBound cash total choices positive
  have strict := Nat.mul_lt_mul_of_pos_left (show total-1<total by omega) nonempty
  exact ⟨le,Nat.lt_of_mul_lt_mul_right (gap ▸ lt_of_le_of_lt upper strict)⟩
end Inv12
