import Inv48LiquidationVerifiedAdapter
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace LiquidationReplay
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- Pathwise successful evaluation refinement, including the exact interaction
transcript and result. This makes no all-answers tree-completeness claim. -/
def Replays {α : Type} (lo hi : SolI α) : Prop :=
  ∀ tr v, Interaction.Executes lo tr (.ok v) → Interaction.Executes hi tr (.ok v)

theorem same {α : Type} (t : SolI α) : Replays t t := fun _ _ h => h

theorem binds {α β : Type} {lo hi : SolI α} {k l : α → SolI β}
    (a : Replays lo hi) (b : ∀ v, Replays (k v) (l v)) :
    Replays (lo >>= k) (hi >>= l) := by
  intro tr out run
  obtain ⟨v,xs,ys,eq,first,last⟩ := GuardRecovery.bindSuccess _ _ _ _ run
  subst tr
  exact Interaction.Executes.bind_ok (a xs v first) (b v ys out last)

theorem lists (n m : Nat)
    (h : ∀ t c r s, Replays (Stmt.eval n t c r s) (Stmt.eval m t c r s)) :
    ∀ t c r ss, Replays (Stmt.evalList n t c r ss) (Stmt.evalList m t c r ss) := by
  intro t c r ss
  induction ss generalizing r with
  | nil => simp only [Stmt.evalList]; exact same _
  | cons s ss ih =>
    simp only [Stmt.evalList]
    apply binds (h _ _ _ _)
    intro v
    cases v <;> first | with_reducible exact same _ | with_reducible exact ih _

theorem step (n m : Nat)
    (he : ∀ t c r s, Replays (Stmt.eval n t c r s) (Stmt.eval m t c r s))
    (hl : ∀ t c r ss, Replays (Stmt.evalList n t c r ss) (Stmt.evalList m t c r ss))
    (hw : ∀ t c r e s, Replays (Stmt.evalWhile n t c r e s) (Stmt.evalWhile m t c r e s))
    (hd : ∀ t c r s e, Replays (Stmt.evalDoWhile n t c r s e) (Stmt.evalDoWhile m t c r s e))
    (hf : ∀ t c r e p s, Replays (Stmt.evalFor n t c r e p s) (Stmt.evalFor m t c r e p s)) :
    ∀ t c r s, Replays (Stmt.eval (n+1) t c r s) (Stmt.eval (m+1) t c r s) := by
  intro t c r s
  cases s <;> simp only [Stmt.eval]
  -- Restrict unification transparency so the shared expression evaluators stay
  -- opaque; split only the fuel-dependent control-flow continuations.
  all_goals
    repeat' first
      | with_reducible exact same _
      | with_reducible exact he _ _ _ _
      | with_reducible exact hl _ _ _ _
      | with_reducible exact hw _ _ _ _ _
      | with_reducible exact hd _ _ _ _ _
      | with_reducible exact hf _ _ _ _ _ _
      | with_reducible apply binds
      | split
      | (intro v)

end LiquidationReplay
