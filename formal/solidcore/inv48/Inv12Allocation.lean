import Inv12Rounding
namespace Inv12

theorem replaceBranch (cash total old extra : Nat) (before after : List Nat) :
    assigned cash total (before++[old+extra]++after) =
    assigned cash total (before++[old]++after) + (cash*(old+extra)/total-cash*old/total) := by
  have up : cash*old/total≤cash*(old+extra)/total :=
    Nat.div_le_div_right (Nat.mul_le_mul_left _ (Nat.le_add_right _ _))
  simp only [assigned,List.map_append,List.map_cons,List.map_nil,List.sum_append,List.sum_cons,List.sum_nil,Nat.add_zero]
  omega

theorem branchFits (cash total chosen : Nat) (word : cash<2^256) (covered : chosen≤total) :
    cash*chosen/total<2^256 := by
  cases total with
  | zero => simp
  | succ d =>
    apply lt_of_le_of_lt _ word
    calc
      cash*chosen/(d+1) ≤ cash*(d+1)/(d+1) := Nat.div_le_div_right (Nat.mul_le_mul_left _ covered)
      _ = cash := Nat.mul_div_cancel _ (Nat.succ_pos _)

/-- An unchosen liability can leave arbitrarily more cash than the rounding remainder. -/
theorem unchosen (cash : Nat) : assigned (2*cash) 2 [1]=cash := by
  simp [assigned,Nat.mul_comm 2 cash]
end Inv12
