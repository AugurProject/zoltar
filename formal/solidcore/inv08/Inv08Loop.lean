import Inv08LoopStep
open SolidCore.Solidity.Source
namespace Inv08.Expiry
private theorem closed (rt : Runtime) (t : FunctionTable) (c : Context) (n : Nat)
    (read : guard.value.eval c rt = pure (.word 0,rt)) :
    Stmt.evalWhile (n+1) t c rt guard.value iteration.value = pure (.normal rt) := by
  rw [Stmt.evalWhile,read]; rfl
private theorem advances (rt next : Runtime) (t : FunctionTable) (c : Context) (n : Nat)
    (read : guard.value.eval c rt = pure (.word 1,rt))
    (step : iteration.value.eval n t c rt = pure (.normal next)) :
    Stmt.evalWhile (n+1) t c rt guard.value iteration.value =
      Stmt.evalWhile n t c next guard.value iteration.value := by
  rw [Stmt.evalWhile, read]
  change (do match ← iteration.value.eval n t c rt with
             | .normal r | .continued r => Stmt.evalWhile n t c r guard.value iteration.value
             | .broke r => pure (.normal r)
             | result => pure result) = _
  rw [step]; rfl

/-- The generated loop performs at most 48 iterations for uint48 bounds, including an even-width interval. -/
theorem loop (n k : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (time lo hi last : Nat)
    (ends : Nat → Nat) (ch : c.checked=true) (tf : time<2^48) (pos : 0<lo) (ordered : lo≤hi)
    (hf : hi<2^48) (bound : hi≤last) (width : hi-lo<2^k)
    (endBound : ∀ i, i≤last → ends i<2^48) (records : EndTable c r.state ends last) :
    let q := search ends time k lo hi
    Stmt.evalWhile (n+6+k) t c (range r time lo hi) guard.value iteration.value = pure (.normal (range r time q q)) := by
  induction k generalizing lo hi with
  | zero =>
    have h : lo=hi := by simp only [Nat.pow_zero] at width; omega
    subst hi
    exact closed _ _ _ _ (by simpa using ltEval c (range r time lo lo) lo lo hf hf rfl rfl)
  | succ k ih =>
    have test := ltEval c (range r time lo hi) lo hi (lt_of_le_of_lt ordered hf) hf rfl rfl
    by_cases run : lo<hi
    · rw [show n+6+(k+1) = (n+k+1)+5+1 by omega]
      have S := step (n+k+1) t c r time lo hi last ends ch tf pos run hf bound endBound records
      let m := middle lo hi
      have M : lo<m ∧ m≤hi := by dsimp [m,middle]; omega
      have pow := Nat.two_pow_pos k
      rw [Nat.pow_succ] at width
      have a : hi-m<2^k := by dsimp [m,middle]; omega
      have b : m-1-lo<2^k := by dsimp [m,middle]; omega
      dsimp only at S
      by_cases passed : ends m≤time
      · rw [if_pos passed] at S
        rw [advances _ _ _ _ _ (by simpa [run] using test) S]
        simpa [search,run,passed,m,Nat.add_assoc,Nat.add_left_comm,Nat.add_comm] using
          ih m hi (by omega) M.2 hf bound a
      · rw [if_neg passed] at S
        rw [advances _ _ _ _ _ (by simpa [run] using test) S]
        simpa [search,run,passed,m,Nat.add_assoc,Nat.add_left_comm,Nat.add_comm] using
          ih lo (m-1) pos (by omega) (by omega) (by omega) b
    · have e : lo=hi := by omega
      subst hi
      simpa [search] using closed (range r time lo lo) t c (n+6+k)
        (by simpa using test)
end Inv08.Expiry
