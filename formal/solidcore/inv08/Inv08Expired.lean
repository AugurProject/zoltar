import Inv08Schedule
namespace Inv08
def middle (lo hi : Nat) := lo+(hi-lo+1)/2
def search (endAt : Nat → Nat) (time : Nat) : Nat → Nat → Nat → Nat
  | 0, lo, _ => lo
  | fuel+1, lo, hi =>
    if lo<hi then
      let mid := middle lo hi
      if endAt mid≤time then search endAt time fuel mid hi else search endAt time fuel lo (mid-1)
    else lo

theorem binaryBoundary (endAt : Nat → Nat) (time fuel lo hi : Nat)
    (width : hi-lo<2^fuel) (ordered : lo≤hi) (starts : endAt lo≤time)
    (sorted : Monotone endAt) :
    let found := search endAt time fuel lo hi
    lo≤found ∧ found≤hi ∧ ∀ i, lo≤i → i≤hi → (endAt i≤time ↔ i≤found) := by
  induction fuel generalizing lo hi with
  | zero =>
    simp only [Nat.pow_zero] at width
    have e : hi=lo := by omega
    subst hi
    refine ⟨le_rfl,le_rfl,?_⟩
    intro i ge le
    have h : i=lo := by omega
    subst i
    simp [search,starts]
  | succ f ih =>
    dsimp only [search]
    by_cases nonempty : lo<hi
    · rw [if_pos nonempty]
      let mid := middle lo hi
      have cut : lo<mid ∧ mid≤hi := by dsimp [mid,middle]; omega
      have pow := Nat.two_pow_pos f
      rw [Nat.pow_succ] at width
      by_cases expired : endAt mid≤time
      · rw [if_pos expired]
        rw [show middle lo hi=mid from rfl]
        have part : hi-mid<2^f := by dsimp [mid,middle]; omega
        obtain ⟨a,b,h⟩ := ih mid hi part cut.2 expired
        refine ⟨by omega,b,?_⟩
        intro i ge le
        by_cases split : mid≤i
        · exact h _ split le
        · exact iff_of_true (le_trans (sorted (by omega : i≤mid)) expired) (by omega)
      · rw [if_neg expired]
        rw [show middle lo hi=mid from rfl]
        have part : mid-1-lo<2^f := by dsimp [mid,middle]; omega
        obtain ⟨a,b,h⟩ := ih lo (mid-1) part (by omega) starts
        refine ⟨a,by omega,?_⟩
        intro i ge le
        by_cases split : i≤mid-1
        · exact h _ ge split
        · exact iff_of_false (fun e => expired (le_trans (sorted (by omega : mid≤i)) e)) (by omega)
    · rw [if_neg nonempty]
      have h : hi=lo := by omega
      subst hi
      refine ⟨le_rfl,le_rfl,?_⟩
      intro i ge le
      have h : i=lo := by omega
      subst i
      simp [starts]
end Inv08
