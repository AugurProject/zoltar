import Inv48CollateralCloneFuelReplay
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneFuel
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem whileStep (n m : Nat)
    (he : ∀ t c r s, Replays (Stmt.eval n t c r s) (Stmt.eval m t c r s))
    (hw : ∀ t c r e s, Replays (Stmt.evalWhile n t c r e s) (Stmt.evalWhile m t c r e s)) :
    ∀ t c r e s, Replays (Stmt.evalWhile (n+1) t c r e s) (Stmt.evalWhile (m+1) t c r e s) := by
  intro t c r e s
  simp only [Stmt.evalWhile]
  repeat' first
    | with_reducible exact same _
    | with_reducible exact he _ _ _ _
    | with_reducible exact hw _ _ _ _ _
    | with_reducible apply binds
    | split
    | (intro v)

theorem doStep (n m : Nat)
    (he : ∀ t c r s, Replays (Stmt.eval n t c r s) (Stmt.eval m t c r s))
    (hd : ∀ t c r s e, Replays (Stmt.evalDoWhile n t c r s e) (Stmt.evalDoWhile m t c r s e)) :
    ∀ t c r s e, Replays (Stmt.evalDoWhile (n+1) t c r s e) (Stmt.evalDoWhile (m+1) t c r s e) := by
  intro t c r s e
  simp only [Stmt.evalDoWhile]
  repeat' first
    | with_reducible exact same _
    | with_reducible exact he _ _ _ _
    | with_reducible exact hd _ _ _ _ _
    | with_reducible apply binds
    | split
    | (intro v)

theorem forStep (n m : Nat)
    (he : ∀ t c r s, Replays (Stmt.eval n t c r s) (Stmt.eval m t c r s))
    (hf : ∀ t c r e p s, Replays (Stmt.evalFor n t c r e p s) (Stmt.evalFor m t c r e p s)) :
    ∀ t c r e p s, Replays (Stmt.evalFor (n+1) t c r e p s) (Stmt.evalFor (m+1) t c r e p s) := by
  intro t c r e p s
  simp only [Stmt.evalFor]
  repeat' first
    | with_reducible exact same _
    | with_reducible exact he _ _ _ _
    | with_reducible exact hf _ _ _ _ _ _
    | with_reducible apply binds
    | split
    | (intro v)

private theorem allReplay (n : Nat) :
    (∀ m, n ≤ m → ∀ t c r (s : Stmt), Replays (Stmt.eval n t c r s) (Stmt.eval m t c r s)) ∧
    (∀ m, n ≤ m → ∀ t c r (ss : List Stmt), Replays (Stmt.evalList n t c r ss) (Stmt.evalList m t c r ss)) ∧
    (∀ m, n ≤ m → ∀ t c r (e : Expr) (s : Stmt), Replays (Stmt.evalWhile n t c r e s) (Stmt.evalWhile m t c r e s)) ∧
    (∀ m, n ≤ m → ∀ t c r (s : Stmt) (e : Expr), Replays (Stmt.evalDoWhile n t c r s e) (Stmt.evalDoWhile m t c r s e)) ∧
    (∀ m, n ≤ m → ∀ t c r (e : Expr) (p s : Stmt), Replays (Stmt.evalFor n t c r e p s) (Stmt.evalFor m t c r e p s)) := by
  induction n with
  | zero =>
    have he : ∀ m, 0 ≤ m → ∀ t c r (s : Stmt), Replays (Stmt.eval 0 t c r s) (Stmt.eval m t c r s) := by
      intro m hm t c r s tr v run
      rw [Stmt.eval] at run
      cases run
    refine ⟨he, ?_, ?_, ?_, ?_⟩
    · intro m hm t c r ss
      exact lists 0 m (he m hm) t c r ss
    · intro m hm t c r e s tr v run
      rw [Stmt.evalWhile] at run
      cases run
    · intro m hm t c r s e tr v run
      rw [Stmt.evalDoWhile] at run
      cases run
    · intro m hm t c r e p s tr v run
      rw [Stmt.evalFor] at run
      cases run
  | succ n ih =>
    obtain ⟨he,hl,hw,hd,hf⟩ := ih
    have es : ∀ m, n+1 ≤ m → ∀ t c r (s : Stmt), Replays (Stmt.eval (n+1) t c r s) (Stmt.eval m t c r s) := by
      intro m hm
      cases m with
      | zero => omega
      | succ m => exact step n m (he m (by omega)) (hl m (by omega)) (hw m (by omega)) (hd m (by omega)) (hf m (by omega))
    refine ⟨es, ?_, ?_, ?_, ?_⟩
    · intro m hm t c r ss
      exact lists (n+1) m (es m hm) t c r ss
    · intro m hm
      cases m with
      | zero => omega
      | succ m => exact whileStep n m (he m (by omega)) (hw m (by omega))
    · intro m hm
      cases m with
      | zero => omega
      | succ m => exact doStep n m (he m (by omega)) (hd m (by omega))
    · intro m hm
      cases m with
      | zero => omega
      | succ m => exact forStep n m (he m (by omega)) (hf m (by omega))

/-- Preserve the complete successful transcript and result under increased fuel. -/
theorem replay {n m : Nat} (le : n ≤ m) (t : FunctionTable) (c : Context) (r : Runtime) (s : Stmt) :
    Replays (Stmt.eval n t c r s) (Stmt.eval m t c r s) :=
  (allReplay n).1 m le t c r s

theorem replayList {n m : Nat} (le : n ≤ m) (t : FunctionTable) (c : Context) (r : Runtime) (ss : List Stmt) :
    Replays (Stmt.evalList n t c r ss) (Stmt.evalList m t c r ss) :=
  (allReplay n).2.1 m le t c r ss

end Inv48.CollateralCloneFuel
