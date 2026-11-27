import Lean

namespace Inv40

/-- Division as written in getForkThresholdAttoRep. -/
def fork (s d : Nat) := s / d + (if s % d = 0 then 0 else 1)

/-- Division as written in getNonDecisionThresholdAttoRep, applied to the fork threshold. -/
def nonDecision (s d : Nat) := fork s d / 2 + fork s d % 2

theorem fork_le (s d k : Nat) (hd : 0 < d) : fork s d ≤ k ↔ s ≤ k * d := by
  have decomp := Nat.div_add_mod s d
  rw [Nat.mul_comm d] at decomp
  have rem := Nat.mod_lt s hd
  unfold fork
  split
  next zero =>
    simp only [Nat.add_zero]
    rw [zero, Nat.add_zero] at decomp
    constructor
    · intro h
      exact decomp ▸ Nat.mul_le_mul_right d h
    · intro h
      exact Nat.le_of_mul_le_mul_right (decomp.symm ▸ h : s / d * d ≤ k*d) hd
  next nonzero =>
    constructor
    · intro h
      have m := Nat.mul_le_mul_right d h
      rw [Nat.add_mul, Nat.one_mul] at m
      omega
    · intro h
      by_cases small : k ≤ s / d
      · have m := Nat.mul_le_mul_right d small
        omega
      · omega

theorem nonDecision_eq (s d : Nat) (hd : 0 < d) : nonDecision s d = fork s (2*d) := by
  have half : nonDecision s d = fork (fork s d) 2 := by
    change fork s d / 2 + fork s d % 2 = fork s d / 2 + (if fork s d % 2 = 0 then 0 else 1)
    split <;> omega
  have same (k : Nat) : nonDecision s d ≤ k ↔ fork s (2*d) ≤ k := by
    rw [half, fork_le _ _ _ (by decide), fork_le _ _ _ hd, fork_le _ _ _ (by omega),
      Nat.mul_assoc]
  exact Nat.le_antisymm ((same _).mpr (Nat.le_refl _)) ((same _).mp (Nat.le_refl _))

/-- The smallest reduction which lowers the threshold, including reductions to zero. -/
theorem thresholdStep (s d : Nat) (hs : 0 < s) (hd : 0 < d) :
    let delta := 1 + (s-1) % d
    delta ≤ s ∧ fork (s-delta) d + 1 = fork s d ∧
      ∀ loss < delta, fork (s-loss) d = fork s d := by
  dsimp only
  let q := (s-1)/d
  let r := (s-1)%d
  have decomp : q*d + r = s-1 := by simpa [q,r,Nat.mul_comm] using Nat.div_add_mod (s-1) d
  have rem : r < d := Nat.mod_lt _ hd
  have upper : s ≤ (q+1)*d := by rw [Nat.add_mul,Nat.one_mul]; omega
  have floorAt (loss : Nat) (small : loss ≤ r) : fork (s-loss) d = q+1 := by
    have up := (fork_le (s-loss) d (q+1) hd).mpr (by omega)
    have lo : ¬ fork (s-loss) d ≤ q := fun h => (by have := (fork_le _ _ _ hd).mp h; omega)
    omega
  have start : fork s d = q+1 := by simpa using floorAt 0 (Nat.zero_le _)
  change 1+r ≤ s ∧ fork (s-(1+r)) d + 1 = fork s d ∧ _
  refine ⟨by omega, ?_, fun loss small => (floorAt loss (by omega)).trans start.symm⟩
  have atStep : s-(1+r) = q*d := by omega
  rw [atStep,start]
  simp [fork,Nat.mul_div_cancel _ hd]

/-- Apply the step theorem to both actual getter formulas, even when twice the
divisor would overflow a Solidity word. Solidity never computes that product. -/
theorem bothSteps (s d : Nat) (hs : 0<s) (hd : 0<d) :
    let decreasesAt := fun (f : Nat → Nat) (k : Nat) =>
      k ≤ s ∧ f (s-k) + 1 = f s ∧ ∀ loss < k, f (s-loss) = f s
    decreasesAt (fun x => fork x d) (1+(s-1)%d) ∧
    decreasesAt (fun x => nonDecision x d) (1+(s-1)%(2*d)) := by
  exact ⟨thresholdStep s d hs hd, by
    simpa only [nonDecision_eq _ _ hd] using thresholdStep s (2*d) hs (by omega)⟩

end Inv40
