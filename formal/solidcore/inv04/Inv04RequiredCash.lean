import Inv27Generated

/-! INV-04 for the settlement pricing formula. The order equivalence is over
mathematical integers (written without subtraction). The public Solidity calls
below separately check the carried remainder and the uint256 execution boundary. -/
open SolidCore.Solidity SolidCore.Solidity.Source

namespace Inv04Source

private abbrev scale := 10^9
private def ceilQuot (x d : Nat) : Nat := (x + (d - 1)) / d

private theorem ceil_le (x d k : Nat) (hd : 0 < d) :
    ceilQuot x d ≤ k ↔ x ≤ k * d := by
  unfold ceilQuot
  rw [Nat.div_le_iff_le_mul_add_pred hd, Nat.mul_comm d k]
  omega

def minimumCash (units numerator denominator remainder : Nat) : Nat :=
  ceilQuot (ceilQuot (units * numerator) denominator + remainder) scale

/-- Largest scaled amount a given budget can cover, including the carry. -/
private theorem scaled_le (u n d r budget : Nat) (hd : 0 < d) :
    ceilQuot (u*n) d + r ≤ budget ↔ u*n + r*d ≤ budget*d := by
  constructor
  · intro h
    have q := (ceil_le (u*n) d _ hd).mp (Nat.le_refl _)
    have scaled := Nat.mul_le_mul_right d h
    rw [Nat.add_mul] at scaled
    omega
  · intro h
    have fits : r ≤ budget := by
      apply Nat.le_of_mul_le_mul_right _ hd
      omega
    have split := congrArg (fun x => x * d) (Nat.sub_add_cancel fits)
    simp only [Nat.add_mul] at split
    have need : u * n ≤ (budget - r) * d := by omega
    have q := (ceil_le _ _ _ hd).mpr need
    omega

/-- Equivalent to (c * scale - remainder) * denominator ≥ units * numerator
with signed subtraction. This form also handles zero units and positive carry. -/
theorem minimumCash_le (u n d r c : Nat) (hd : 0 < d) :
    minimumCash u n d r ≤ c ↔ u * n + r * d ≤ (c * scale) * d :=
  (ceil_le _ _ _ (by decide)).trans (scaled_le _ _ _ _ _ hd)

/-- Exact fit condition for the intermediate, before the final division by scale. -/
theorem scaledWordFits_iff (u n d r : Nat) (hd : 0 < d) :
    ceilQuot (u*n) d + r ≤ 2^256-1 ↔ u*n + r*d ≤ (2^256-1)*d :=
  scaled_le _ _ _ _ _ hd

/-- If the minimum is within the book's raw-cash cap, the rounded scaled
requirement including the carry fits in the intermediate Solidity word. -/
theorem scaledFitsForBookCash (u n d r : Nat) (h : minimumCash u n d r < 2^128) :
    ceilQuot (u*n) d + r < 2^256 := by
  have fit := (ceil_le _ scale (2^128 - 1) (by decide)).mp (show minimumCash u n d r ≤ 2^128-1 by omega)
  exact lt_of_le_of_lt fit (by decide)

private inductive Observation where
  | returned (cash : Nat)
  | panic (code : Nat)
  deriving DecidableEq

private def requiredCash (u n d r : Nat) : Option Observation := do
  let .ok model := TypeCheck.CheckedInput.contract Inv27Generated.importedSourceUnit "InvariantMathHarness" | none
  let result ← TypeCheck.CheckedContract.call? 50000 model (.name "requiredCash") State.empty
    [.word u, .word n, .word d, .word r]
  match result with
  | .returned _ [.word cash] => some (.returned cash)
  | .reverted _ (.panic code) => some (.panic code)
  | _ => none

/-- A one-unit scaled carry crosses a raw-cash boundary in the generated contract. -/
theorem carriedRemainderChangesQuote :
    requiredCash scale 1 1 0 = some (.returned 1) ∧
    requiredCash scale 1 1 1 = some (.returned 2) := by native_decide

/-- For unrestricted helper arguments the final minimum can fit even though
adding the carry to the first rounded quotient overflows. -/
theorem intermediateOverflow :
    minimumCash (2^256-1) 1 1 1 < 2^256 ∧
    requiredCash (2^256-1) 1 1 0 = some (.returned (minimumCash (2^256-1) 1 1 0)) ∧
    requiredCash (2^256-1) 1 1 1 = some (.panic 0x11) := by native_decide

end Inv04Source

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Quot.sound, ``Lean.ofReduceBool, ``Lean.trustCompiler]
  for name in #[``Inv04Source.minimumCash_le, ``Inv04Source.scaledWordFits_iff,
      ``Inv04Source.scaledFitsForBookCash,
      ``Inv04Source.carriedRemainderChangesQuote, ``Inv04Source.intermediateOverflow] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-04 axiom {dep}"
