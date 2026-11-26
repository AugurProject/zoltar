import Lean
namespace Inv39
structure Supply where
  theoretical : Nat
  circulating : Nat
deriving DecidableEq
inductive Change where
  | mint (amount : Nat)
  | burn (amount : Nat)
  | unchanged
def Change.minted : Change → Nat
  | .mint amount => amount
  | _ => 0
/-- Only completed, in-domain changes are part of the supply history. -/
def Change.apply : Change → Supply → Option Supply
  | .mint a, s => if s.circulating + a ≤ s.theoretical then some {s with circulating := s.circulating+a} else none
  | .burn a, s => if a ≤ s.circulating then some ⟨s.theoretical-a,s.circulating-a⟩ else none
  | .unchanged, s => some s
theorem accountingStep (initial minted : Nat) (s post : Supply) (change : Change)
    (books : s.theoretical + minted = initial + s.circulating)
    (solvent : s.circulating ≤ s.theoretical) (ok : change.apply s = some post) :
    post.theoretical + (minted + change.minted) = initial + post.circulating ∧
      post.circulating ≤ post.theoretical := by
  cases change with
  | unchanged => simp [Change.apply] at ok; subst post; simpa [Change.minted] using And.intro books solvent
  | mint a =>
    simp only [Change.apply] at ok
    split at ok
    · injection ok with e; subst post; simp only [Change.minted]; constructor <;> omega
    · contradiction
  | burn a =>
    simp only [Change.apply] at ok
    split at ok
    · injection ok with e; subst post; simp only [Change.minted]; constructor <;> omega
    · contradiction
theorem accountingHistory (initial minted : Nat) (s post : Supply) (changes : List Change)
    (books : s.theoretical + minted = initial + s.circulating)
    (solvent : s.circulating ≤ s.theoretical)
    (ok : changes.foldlM (fun acc ch => ch.apply acc) s = some post) :
    post.theoretical - post.circulating = initial - (minted + (changes.map Change.minted).sum) ∧
    minted + (changes.map Change.minted).sum ≤ initial := by
  induction changes generalizing minted s with
  | nil => simp at ok; subst post; simp; omega
  | cons ch tail ih =>
    cases h : ch.apply s with
    | none => simp [List.foldlM,h] at ok
    | some p =>
      have step := accountingStep _ _ _ _ _ books solvent h
      have ok' : tail.foldlM (fun acc event => event.apply acc) p = some post := by simpa [List.foldlM,h] using ok
      simpa [Nat.add_assoc] using ih _ _ step.1 step.2 ok'
end Inv39
