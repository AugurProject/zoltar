import Inv33Proved

namespace Inv34Source
open Inv32
open Inv32Source (returnsAmount)
open Inv33Source (exactInputFloorBound)

/-- Reverse the first exact-input trade using its entire output. With no
intervening reserve changes, a successful reverse quote pays at most the
original gross input. The pair retains the first fee in its input reserve. -/
theorem roundTripExactInput (x y gross fee bought recovered : Nat)
    (hreserve : x + gross < word) (hy : y < word) (hf : fee < word)
    (first : returnsAmount "quoteExactInput" x y gross fee bought)
    (back : returnsAmount "quoteExactInput" (y - bought) (x + gross) bought fee recovered) :
    recovered ≤ gross := by
  obtain ⟨_, _, below, _, forwardBound⟩ :=
    exactInputFloorBound _ _ _ _ _ (by omega) hy (by omega) hf first
  obtain ⟨_, _, _, _, reverseBound⟩ :=
    exactInputFloorBound _ _ _ _ _ (by omega) hreserve (by omega) hf back
  let remaining := y - bought
  let net := netInput gross fee
  let reverseNet := netInput bought fee
  have reserveSum : remaining + bought = y := Nat.sub_add_cancel (by omega)
  have firstCost : bought * x ≤ remaining * net := by
    change bought * (x + net) ≤ y * net at forwardBound
    rw [← reserveSum, Nat.add_mul, Nat.mul_add] at forwardBound
    omega
  have priced : x * reverseNet ≤ gross * remaining := by
    calc
      x * reverseNet ≤ x * bought := Nat.mul_le_mul_left _ (Inv32ForwardSteps.netBound _ _)
      _ = bought * x := Nat.mul_comm _ _
      _ ≤ remaining * net := firstCost
      _ ≤ remaining * gross := Nat.mul_le_mul_left _ (Inv32ForwardSteps.netBound _ _)
      _ = gross * remaining := Nat.mul_comm _ _
  have bound : recovered * (remaining + reverseNet) ≤ gross * (remaining + reverseNet) := by
    calc
      _ ≤ (x + gross) * reverseNet := reverseBound
      _ ≤ gross * (remaining + reverseNet) := by rw [Nat.add_mul, Nat.mul_add]; omega
  exact Nat.le_of_mul_le_mul_right bound (by dsimp [remaining]; omega)

/-- With equal reserves of two units and zero fee, trading two units buys
one unit, which buys back exactly two in the updated pool. -/
theorem equalityExample :
    returnsAmount "quoteExactInput" 2 2 2 0 1 ∧
    returnsAmount "quoteExactInput" 1 4 1 0 2 := by
  constructor <;> exact ⟨0, by native_decide⟩

end Inv34Source

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Lean.ofReduceBool, ``Lean.trustCompiler, ``Quot.sound]
  for thm in #[``Inv34Source.roundTripExactInput, ``Inv34Source.equalityExample] do
    for dep in ← collectAxioms thm do
      unless allowed.contains dep do throwError "Unexpected axiom {dep} in {thm}"

#print axioms Inv34Source.roundTripExactInput
