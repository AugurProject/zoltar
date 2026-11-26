import Inv32Writes
open SolidCore.Solidity.Source
namespace Inv32Scalar
def choice (cond left right : Formula) : Formula where
  core := .ternary cond.core left.core right.core
  depth := max cond.depth (max left.depth right.depth) + 1
  run c env := do
    let cv ← cond.run c env
    (if wordTruthy (normWord cv) then left else right).run c env
  sound fuel c r env v enough modeled hit := by
    cases fuel with
    | zero => omega
    | succ n =>
      cases h : cond.run c.checked env with
      | none => simp [h] at hit
      | some cv =>
        have read := cond.sound n c r env cv (by omega) modeled h
        have pureBind {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
        rw [Expr.evalFuel,read]
        simp only [pureBind]
        change (if wordTruthy (normWord cv) then Expr.evalFuel n c r left.core else Expr.evalFuel n c r right.core) = _
        cases yes : wordTruthy (normWord cv) <;> simp [h,yes] at hit ⊢
        · exact right.sound _ _ _ _ _ (by omega) modeled hit
        · exact left.sound _ _ _ _ _ (by omega) modeled hit
end Inv32Scalar
