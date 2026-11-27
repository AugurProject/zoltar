import Inv08SearchExecution

namespace Inv08.Expiry
private theorem searchAgrees (f g : Nat → Nat) (tm k lo hi : Nat)
    (same : ∀ i, lo≤i → i≤hi → f i=g i) : search f tm k lo hi=search g tm k lo hi := by
  induction k generalizing lo hi with
  | zero => rfl
  | succ k ih =>
    simp only [search]
    by_cases run : lo<hi
    · rw [if_pos run,if_pos run]
      have bounds : lo<middle lo hi ∧ middle lo hi≤hi := by unfold middle; omega
      rw [same _ (by omega) bounds.2]
      split
      · exact ih _ _ (fun i l h => same i (by omega) h)
      · exact ih _ _ (fun i l h => same i l (by omega))
    · rw [if_neg run,if_neg run]

/-- Only funded record IDs 1 through last are ordered. The Solidity mapping
beyond the last ID contains zeroes, so no monotonicity is required there. -/
theorem selectedBoundary (ends : Nat → Nat) (tm settled last : Nat)
    (ordered : settled≤last) (paid : settled=0 ∨ ends settled≤tm) (fit : last<2^48)
    (sorted : ∀ i j, 0<i → i≤j → j≤last → ends i≤ends j) :
    let q := selected ends tm settled last
    settled≤q ∧ q≤last ∧ ∀ i, 0<i → i≤last → (ends i≤tm ↔ i≤q) := by
  dsimp only [selected]
  by_cases top : last=0 ∨ ends last≤tm
  · rw [if_pos top]
    refine ⟨ordered,le_rfl,?_⟩
    intro i pos hi
    exact iff_of_true (by rcases top with h|h; omega; exact le_trans (sorted i last pos hi le_rfl) h) hi
  · rw [if_neg top]
    have lt : settled<last := by
      by_contra h
      have eq : settled=last := by omega
      rw [←eq] at top; exact top paid
    have paidPrefix : ∀ i, 0<i → i≤settled → ends i≤tm := by
      intro i pos hi
      rcases paid with zero|ok
      · omega
      · exact le_trans (sorted i settled pos hi ordered) ok
    by_cases next : tm<ends (settled+1)
    · rw [if_pos next]
      refine ⟨le_rfl,ordered,?_⟩
      intro i pos hi
      refine ⟨fun e => ?_,paidPrefix i pos⟩
      by_contra later
      have := sorted (settled+1) i (by omega) (by omega) hi
      omega
    · rw [if_neg next]
      let low := settled+1
      let bounded := fun i => ends (max low (min i last))
      have monotone : Monotone bounded := by
        intro i j h
        apply sorted _ _ (by dsimp [low]; omega) (by omega) (by dsimp [low]; omega)
      have within (i : Nat) (l : low≤i) (h : i≤last) : bounded i=ends i := by simp [bounded,min_eq_left h,max_eq_right l]
      have base : bounded low≤tm := by rw [within low le_rfl lt]; exact Nat.le_of_not_gt next
      have h := binaryBoundary bounded tm 48 low last (by omega) lt base monotone
      dsimp only at h
      rw [searchAgrees bounded ends tm 48 low last within] at h
      obtain ⟨l,u,edge⟩ := h
      refine ⟨by dsimp [low] at l; omega,u,?_⟩
      intro i pos hi
      by_cases beyond : low≤i
      · simpa [within i beyond hi] using edge i beyond hi
      · have early : i≤settled := by dsimp [low] at beyond; omega
        exact iff_of_true (paidPrefix i pos early) (le_trans (Nat.le_of_not_ge beyond) l)
end Inv08.Expiry
