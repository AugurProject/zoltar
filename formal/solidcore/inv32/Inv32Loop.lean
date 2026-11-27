import SolidCore.Solidity.Checked

open SolidCore.Solidity.Source
namespace Inv32Loop

private theorem closed (rt : Runtime) (t : FunctionTable) (c : Context)
    (cond : Expr) (body : Stmt) (n : Nat)
    (read : cond.eval c rt = pure (.word 0, rt)) :
    Stmt.evalWhile (n+1) t c rt cond body = pure (.normal rt) := by
  rw [Stmt.evalWhile, read]
  rfl

private theorem advance (rt next : Runtime) (t : FunctionTable) (c : Context)
    (cond : Expr) (body : Stmt) (n : Nat)
    (read : cond.eval c rt = pure (.word 1, rt))
    (step : body.eval n t c rt = pure (.normal next)) :
    Stmt.evalWhile (n+1) t c rt cond body = Stmt.evalWhile n t c next cond body := by
  rw [Stmt.evalWhile, read]
  change (do
    match ← body.eval n t c rt with
    | .normal r | .continued r => Stmt.evalWhile n t c r cond body
    | .broke r => pure (.normal r)
    | result => pure result) = _
  rw [step]
  rfl

/-- Lift an interval invariant through the checked interpreter's while loop.
    The spare fuel parameter is reserved for nested internal calls in the body. -/
theorem binarySearch (t : FunctionTable) (c : Context) (cond : Expr) (body : Stmt)
    (frame : Runtime → Nat → Nat → Prop) (answer spare : Nat)
    (condition : ∀ rt lo hi, frame rt lo hi →
      cond.eval c rt = pure (.word (if lo < hi then 1 else 0), rt))
    (iteration : ∀ rt lo hi fuel, frame rt lo hi → lo ≤ answer → answer ≤ hi →
      lo < hi → spare ≤ fuel →
      ∃ rt', body.eval fuel t c rt = pure (.normal rt') ∧
        let mid := lo + (hi-lo)/2 + 1
        (mid ≤ answer ∧ frame rt' mid hi) ∨ (answer < mid ∧ frame rt' lo (mid-1)))
    (k : Nat) (rt : Runtime) (lo hi : Nat) (hFrame : frame rt lo hi)
    (lower : lo ≤ answer) (upper : answer ≤ hi) (width : hi-lo < 2^k) :
    ∃ rt', Stmt.evalWhile (spare+k+1) t c rt cond body = pure (.normal rt') ∧
      frame rt' answer answer := by
  induction k generalizing rt lo hi with
  | zero =>
    simp only [Nat.pow_zero] at width
    have l : lo = answer := by omega
    have h : hi = answer := by omega
    subst lo hi
    exact ⟨_,closed _ _ _ _ _ _ (by simpa using condition _ _ _ hFrame),hFrame⟩
  | succ k ih =>
    by_cases run : lo < hi
    · obtain ⟨rt', step, branch⟩ := iteration rt lo hi (spare+k+1) hFrame lower upper run (by omega)
      have eq := advance _ _ _ _ _ _ _ (by simpa [run] using condition _ _ _ hFrame) step
      rw [show spare+(k+1)+1 = spare+k+1+1 by omega, eq]
      rw [Nat.pow_succ] at width
      dsimp only at branch
      rcases branch with ⟨midOk,h⟩ | ⟨midTooHigh,h⟩
      · exact ih _ _ _ h midOk upper (by omega)
      · exact ih _ _ _ h lower (by omega) (by omega)
    · have l : lo = answer := by omega
      have h : hi = answer := by omega
      subst lo hi
      exact ⟨_,closed _ _ _ _ _ _ (by simpa using condition _ _ _ hFrame),hFrame⟩

end Inv32Loop
