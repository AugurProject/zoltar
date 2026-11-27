import Inv27Generated

/-! INV-27's conservative price needs a representable result. With 50% uncertainty,
the upper bound is twice the raw price. The checked Solidity harness returns both
bounds up to the last fitting price and rejects the next price with the domain error. -/
open SolidCore.Solidity SolidCore.Solidity.Source

namespace Inv27Source

private inductive Observation where
  | bounds (lower upper : Nat)
  | rejected (message : String)
  deriving DecidableEq

private def boundsAt (price uncertainty : Nat) : Option Observation := do
  let .ok model := TypeCheck.CheckedInput.contract Inv27Generated.importedSourceUnit "InvariantMathHarness" | none
  let result ← TypeCheck.CheckedContract.call? 50000 model (.name "bounds") State.empty
    [.word price, .word uncertainty]
  match result with
  | .returned _ [.word lo, .word hi] => some (.bounds lo hi)
  | .reverted _ (.error message) => some (.rejected message)
  | _ => none

theorem conservativeOverflowBoundary :
    boundsAt (2^255 - 1) 5000000 =
      some (.bounds ((2^255 - 1) * 2 / 3) (2^256 - 2)) ∧
    boundsAt (2^255) 0 = some (.bounds (2^255) (2^255)) ∧
    boundsAt (2^255) 5000000 = some (.rejected "Conservative oracle price exceeds uint256") := by native_decide

/-- A positive collateral denominator and a uint128 REP amount, as in a funded
report, bound the raw price. Even the largest allowed uncertainty leaves a
denominator of at least one, so the scaled numerator alone fits a word. -/
theorem fundedNumeratorFits (rep collateral : Nat) (hr : rep < 2^128) (_hc : 0 < collateral) :
    (rep * 10^18 / collateral) * 10^7 < 2^256 := by
  have bound := Nat.mul_le_mul_right (10^7) (Nat.div_le_self (rep * 10^18) collateral)
  have cap := Nat.mul_lt_mul_of_pos_right hr (by decide : 0 < 10^18 * 10^7)
  rw [Nat.mul_assoc] at bound
  exact lt_of_le_of_lt bound (lt_trans cap (by decide))

end Inv27Source

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Quot.sound, ``Lean.ofReduceBool, ``Lean.trustCompiler]
  for name in #[``Inv27Source.conservativeOverflowBoundary, ``Inv27Source.fundedNumeratorFits] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-27 axiom {dep}"
