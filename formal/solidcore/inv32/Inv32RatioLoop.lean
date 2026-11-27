import Inv32RatioStep
open SolidCore.Solidity.Source Inv32Division Inv32RatioTest Inv32RatioStep Inv32QuoteExpr Inv32Actions
namespace Inv32RatioLoop
def answer (s p o : Nat) := s*p/(o+p)
theorem bound (s p o : Nat) (pos : 0<o+p) : answer s p o ≤ s := by
  have h := Nat.mul_le_mul_left s (Nat.le_add_left p o)
  exact le_trans (Nat.div_le_div_right h) (le_of_eq (Nat.mul_div_cancel _ pos))
theorem run (n : Nat) (c : Context) (r : Runtime) (s p o : Nat)
    (hs : s<R) (hp : p<R) (ho : o<R) (pos : 0<o+p) (ch : c.checked=true) :
    let q := answer s p o
    Stmt.eval (n+273) Inv32Dispatch.model.core.table c (range r s p o 0 s) (.whileLoop cond.core iteration) =
      pure (.normal (range r s p o q q)) := by
  let t := Inv32Dispatch.model.core.table
  let q := answer s p o
  let frame := fun (rt : Runtime) (l h : Nat) => rt = range r s p o l h ∧ l≤h ∧ h≤s
  have guard (rt : Runtime) (l h : Nat) (H : frame rt l h) :
      cond.core.eval c rt = pure (.word (if l<h then 1 else 0),rt) := by
    obtain ⟨rfl,le,sh⟩ := H
    have ev := evalFormula cond c (range r s p o l h) _ (by decide) (less _ _ "low" "high" _ _
      (lt_of_le_of_lt (le_trans le sh) hs) (lt_of_le_of_lt sh hs) rfl rfl)
    simpa [boolWord] using ev
  have advance (rt : Runtime) (l h fuel : Nat) (H : frame rt l h) (lower : l≤q) (upper : q≤h) (run : l<h) (enough : n+15≤fuel) :
      ∃ rt', Stmt.eval fuel t c rt iteration = pure (.normal rt') ∧
        let m := l+(h-l)/2+1
        (m≤q ∧ frame rt' m h) ∨ (q<m ∧ frame rt' l (m-1)) := by
    obtain ⟨rfl,lh,sh⟩ := H
    let m := Inv32Midpoint.mid l h
    have ef := Inv32RatioStep.run (fuel-15) c r s p o l h hs hp ho run (lt_of_le_of_lt sh hs) ch
    rw [show fuel-15+15=fuel by omega] at ef
    have iff' : m≤q ↔ m*(o+p)≤s*p := Nat.le_div_iff_mul_le pos
    dsimp only at ef ⊢
    by_cases meet : m≤q
    · have yes : Inv32CompareCall.answer m o p s p = true := decide_eq_true (iff'.mp meet)
      rw [if_pos yes] at ef
      exact ⟨_,ef,Or.inl ⟨meet,rfl,le_trans meet upper,sh⟩⟩
    · have no : Inv32CompareCall.answer m o p s p = false := decide_eq_false (fun h => meet (iff'.mpr h))
      rw [if_neg (by rw [no]; decide)] at ef
      have mUpper : m≤h := by dsimp [m,Inv32Midpoint.mid]; omega
      exact ⟨_,ef,Or.inr ⟨Nat.lt_of_not_ge meet,rfl,by change l≤m-1; omega,by change m-1≤s; omega⟩⟩
  have first : frame (range r s p o 0 s) 0 s := ⟨rfl,Nat.zero_le _,le_refl _⟩
  obtain ⟨next,ev,h⟩ := Inv32Loop.binarySearch t c cond.core iteration frame q (n+15) guard advance 256 (range r s p o 0 s) 0 s first
    (Nat.zero_le _) (bound _ _ _ pos) (by simpa using hs)
  rw [Stmt.eval]
  have eqn : next = range r s p o q q := h.1
  rw [eqn] at ev
  exact ev
end Inv32RatioLoop
