import Inv37PairGenerated
import Inv37ReserveCheck
import Inv37Backing

/-! INV-37 at the pair's reserve check. The extracted statement follows the
effective-reserve read and assignments and precedes the Sync event. -/
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Actions Inv32Division
namespace Inv37Source

private opaque generatedGuard? : Option Source.Stmt := do
  let .ok pair := TypeCheck.CheckedInput.contract Inv37PairGenerated.importedSourceUnit
    "TwoWayConstantProductPair" | none
  let fn ← pair.core.table.lookup?
    "__internal__checkReserves(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
  let .block [_, _, .block [_, _, _, _, .captureReturn [a, b]
    (.internalCall [a', b'] "__internal__effectiveReserves()#[]" []),
    .assign (.var "yesBalance") (.var y), .assign (.var "noBalance") (.var n), guard,
    .emitEvent "Sync" [.var "yesBalance", .var "noBalance"]]] := fn.body | none
  if a == a' && b == b' && a == y && b == n && a != b then some guard else none

private def isReserveCheck : Option Source.Stmt → Bool
  | some (.requireStmt (.binary .boolAnd
      (.binary .ge (.castOp .uintCleanup 256 (.var "yesBalance")) (.castOp .uintCleanup 256 (.var "minimumYes")))
      (.binary .ge (.castOp .uintCleanup 256 (.var "noBalance")) (.castOp .uintCleanup 256 (.var "minimumNo"))))
      (some "Balance below expected")) => true
  | _ => false

private theorem checkedShape (g : Option Source.Stmt) (ok : isReserveCheck g = true) :
    g = some reserveCheck := by
  unfold isReserveCheck at ok
  split at ok
  · rfl
  · contradiction

private theorem extracted : generatedGuard? = some reserveCheck :=
  checkedShape _ (by native_decide)

/-- The checked pair's guard really ran and continued with these four local
values. This observation concerns the guard only; the caller determines the
minima and the external share token supplies the observed balances. -/
def passedReserveCheck (y n my mn : Nat) : Prop :=
  ∃ guard fuel table ctx runtime, generatedGuard? = some guard ∧
    locals runtime "yesBalance" = some y ∧ locals runtime "noBalance" = some n ∧
    locals runtime "minimumYes" = some my ∧ locals runtime "minimumNo" = some mn ∧
    Stmt.eval (fuel+1) table ctx runtime guard = pure (.normal runtime)

theorem observedMinima (y n my mn : Nat) (hy : y < R) (hn : n < R)
    (hmy : my < R) (hmn : mn < R) (passed : passedReserveCheck y n my mn) :
    my ≤ y ∧ mn ≤ n := by
  obtain ⟨guard,fuel,t,c,r,hg,Y,N,MY,MN,ran⟩ := passed
  rw [extracted] at hg
  cases hg
  rw [reserveCheckResult _ _ _ _ _ _ _ _ hy hn hmy hmn Y N MY MN] at ran
  by_contra bad
  rw [if_neg bad] at ran
  cases ran

/-- A passing pair check at the expected swap minima discharges both reserve
bounds. The quote is evaluated through the generated public quote harness. -/
theorem swapBackingAtCheck (x y gross out fee supply afterIn afterOut : Nat)
    (hx : x < R) (hy : y < R) (hg : gross < R) (ho : out < R) (hf : fee < R)
    (hi : afterIn < R) (hout : afterOut < R) (sumFits : x + gross < R)
    (quote : Inv32Source.returnsAmount "quoteExactInput" x y gross fee out ∨
             Inv32Source.returnsAmount "quoteExactOutput" x y out fee gross)
    (passed : passedReserveCheck afterIn afterOut (x + gross) (y - out) ∨
              passedReserveCheck afterOut afterIn (y - out) (x + gross)) :
    x * y * supply^2 ≤ afterIn * afterOut * supply^2 := by
  have diffFits := lt_of_le_of_lt (Nat.sub_le y out) hy
  have bounds : x + gross ≤ afterIn ∧ y - out ≤ afterOut := by
    cases passed with
    | inl h => exact observedMinima _ _ _ _ hi hout sumFits diffFits h
    | inr h =>
      have b := observedMinima _ _ _ _ hout hi diffFits sumFits h
      exact ⟨b.2, b.1⟩
  exact swapBacking _ _ _ _ _ _ _ _ hx hy hg ho hf quote bounds.1 bounds.2

/-- Deposit LP accounting when the generated pair check passes at the deposit minima. -/
theorem additionAtCheck (y n s dy dn afterY afterN : Nat) (hy : 0 < y) (hn : 0 < n)
    (ay : afterY < R) (an : afterN < R) (my : y + dy < R) (mn : n + dn < R)
    (passed : passedReserveCheck afterY afterN (y + dy) (n + dn)) :
    let minted := min (dy * s / y) (dn * s / n)
    y * (s + minted) ≤ afterY * s ∧ n * (s + minted) ≤ afterN * s ∧
    y * n * (s + minted)^2 ≤ afterY * afterN * s^2 := by
  obtain ⟨Y, N⟩ := observedMinima _ _ _ _ ay an my mn passed
  exact addition _ _ _ _ _ _ _ hy hn Y N

/-- Withdrawal LP accounting when the generated pair check passes after the payouts. -/
theorem removalAtCheck (y n s burned afterY afterN : Nat) (hs : 0 < s) (hb : burned ≤ s)
    (hy : y < R) (hn : n < R) (ay : afterY < R) (an : afterN < R)
    (passed : passedReserveCheck afterY afterN (y - y * burned / s) (n - n * burned / s)) :
    y * (s - burned) ≤ afterY * s ∧ n * (s - burned) ≤ afterN * s ∧
    y * n * (s - burned)^2 ≤ afterY * afterN * s^2 := by
  obtain ⟨Y, N⟩ := observedMinima _ _ _ _ ay an (lt_of_le_of_lt (Nat.sub_le _ _) hy)
    (lt_of_le_of_lt (Nat.sub_le _ _) hn) passed
  exact removal _ _ _ _ _ _ hs hb Y N

end Inv37Source

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Quot.sound, ``Lean.ofReduceBool, ``Lean.trustCompiler]
  for name in #[``Inv37Source.swapBackingAtCheck, ``Inv37Source.additionAtCheck, ``Inv37Source.removalAtCheck] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-37 pair axiom {dep}"
