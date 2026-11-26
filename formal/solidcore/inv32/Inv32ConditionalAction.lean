import Inv32Actions
import Inv32Blocks
open SolidCore.Solidity.Source Inv32Scalar
namespace Inv32Actions

def writeLiteral (name : String) (v : Nat) : Action where
  core := .assign (.var name) (.word v)
  depth := 1
  run _ r := do
    let _ ← locals r name
    r.assignLocal? name (.word (normWord v))
  sound n t c r next enough hit := by
    cases n with
    | zero => contradiction
    | succ n =>
      cases b : locals r name <;> simp [b] at hit
      rename_i old
      have bound : r.lookupLocal? name = some (.word old) := by
        cases h : r.lookupLocal? name with
        | none => simp [locals,h] at b
        | some v => cases v <;> simp_all [locals]
      exact Inv32Writes.constant n t c r next name old v bound hit

def conditional (e : Formula) (size : e.depth ≤ e.core.orderFuel + 1) (yes no : Action) : Action where
  core := .ifElse e.core yes.core no.core
  depth := max yes.depth no.depth + 1
  run checked r := do
    let flag ← e.run checked (locals r)
    (if wordTruthy (normWord flag) then yes else no).run checked r
  sound n t c r next enough hit := by
    cases n with
    | zero => omega
    | succ n =>
      cases ev : e.run c.checked (locals r) with
      | none => simp [ev] at hit
      | some flag =>
        have read := evalFormula e c r flag size ev
        rw [Stmt.eval]; dsimp only; rw [read]
        change (if wordTruthy (normWord flag) then Stmt.eval n t c r yes.core else Stmt.eval n t c r no.core) = _
        cases b : wordTruthy (normWord flag) <;> simp [ev,b] at hit ⊢
        · exact no.sound _ _ _ _ _ (by omega) hit
        · exact yes.sound _ _ _ _ _ (by omega) hit

end Inv32Actions
