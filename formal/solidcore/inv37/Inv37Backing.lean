import Inv37Swap

namespace Inv37Source

/-- Each side of a deposit backs at least as much reserve per LP token after minting. -/
theorem depositSide (r used s minted : Nat) (hr : 0 < r)
    (limit : minted ≤ used * s / r) :
    r * (s + minted) ≤ (r + used) * s := by
  have h := (Nat.le_div_iff_mul_le hr).mp limit
  rw [Nat.mul_comm minted r] at h
  simpa [Nat.mul_add,Nat.add_mul] using Nat.add_le_add_left h (r*s)

/-- Paying the pro-rata floor when burning LP shares preserves reserve backing per share. -/
theorem removalSide (r s burned : Nat) (hs : 0 < s) (limit : burned ≤ s) :
    r * (s - burned) ≤ (r - r * burned / s) * s := by
  let paid := r * burned / s
  have floorBound : paid * s ≤ r * burned := Nat.div_mul_le_self _ _
  have fits : paid ≤ r := by
    apply Nat.le_of_mul_le_mul_right _ hs
    exact Nat.le_trans floorBound (Nat.mul_le_mul_left r limit)
  have reserve := congrArg (fun k => k * s) (Nat.sub_add_cancel fits)
  have supply := congrArg (fun k => r * k) (Nat.sub_add_cancel limit)
  change r * (s-burned) ≤ (r-paid)*s
  simp only [Nat.mul_add,Nat.add_mul] at reserve supply
  omega

theorem bothSides (y n s y' n' s' : Nat)
    (yes : y*s' ≤ y'*s) (no : n*s' ≤ n'*s) :
    y*n*s'^2 ≤ y'*n'*s^2 := by
  simpa only [Nat.pow_succ,Nat.pow_zero,Nat.one_mul,Nat.mul_one,Nat.mul_assoc,Nat.mul_left_comm,Nat.mul_comm]
    using Nat.mul_le_mul yes no

/-- Reserve checks in the pair give lower bounds; any extra reserve credit,
including an ordinary donation at fixed supply, preserves the product bound. -/
theorem reserveSurplus (y n s yMin nMin sAfter yAfter nAfter : Nat)
    (lower : y*n*sAfter^2 ≤ yMin*nMin*s^2)
    (yes : yMin ≤ yAfter) (no : nMin ≤ nAfter) :
    y*n*sAfter^2 ≤ yAfter*nAfter*s^2 :=
  Nat.le_trans lower (Nat.mul_le_mul_right _ (Nat.mul_le_mul yes no))

theorem donation (y n s yAfter nAfter : Nat)
    (yes : y ≤ yAfter) (no : n ≤ nAfter) :
    y*n*s^2 ≤ yAfter*nAfter*s^2 :=
  reserveSurplus y n s y n s yAfter nAfter (Nat.le_refl _) yes no

/-- Actual reserves may exceed the minima checked by the pair. A deposit
mints the smaller of the two pro-rata floors. Both reserve-per-LP inequalities
and their product then hold for the observed reserves. -/
theorem addition (y n s dy dn afterY afterN : Nat) (hy : 0 < y) (hn : 0 < n)
    (creditedY : y + dy ≤ afterY) (creditedN : n + dn ≤ afterN) :
    let minted := min (dy * s / y) (dn * s / n)
    y * (s + minted) ≤ afterY * s ∧ n * (s + minted) ≤ afterN * s ∧
    y * n * (s + minted)^2 ≤ afterY * afterN * s^2 := by
  let minted := min (dy * s / y) (dn * s / n)
  have Y := Nat.le_trans (depositSide y dy s minted hy (Nat.min_le_left _ _))
    (Nat.mul_le_mul_right s creditedY)
  have N := Nat.le_trans (depositSide n dn s minted hn (Nat.min_le_right _ _))
    (Nat.mul_le_mul_right s creditedN)
  exact ⟨Y, N, bothSides _ _ _ _ _ _ Y N⟩

/-- Independent floors include dust exits where only one outcome is paid. -/
theorem removal (y n s burned afterY afterN : Nat) (hs : 0 < s) (hb : burned ≤ s)
    (remainingY : y - y * burned / s ≤ afterY) (remainingN : n - n * burned / s ≤ afterN) :
    y * (s - burned) ≤ afterY * s ∧ n * (s - burned) ≤ afterN * s ∧
    y * n * (s - burned)^2 ≤ afterY * afterN * s^2 := by
  have Y := Nat.le_trans (removalSide y s burned hs hb) (Nat.mul_le_mul_right s remainingY)
  have N := Nat.le_trans (removalSide n s burned hs hb) (Nat.mul_le_mul_right s remainingN)
  exact ⟨Y, N, bothSides _ _ _ _ _ _ Y N⟩

/-- Input/output reserves are ordered in the trade direction. Both generated
quote entry points cover either direction. Surplus reserves are allowed and
LP supply is held fixed across the swap. -/
theorem swapBacking (x y gross out fee supply afterIn afterOut : Nat)
    (hx : x < Inv32.word) (hy : y < Inv32.word) (hg : gross < Inv32.word)
    (ho : out < Inv32.word) (hf : fee < Inv32.word)
    (quote : Inv32Source.returnsAmount "quoteExactInput" x y gross fee out ∨
             Inv32Source.returnsAmount "quoteExactOutput" x y out fee gross)
    (credit : x + gross ≤ afterIn) (debit : y - out ≤ afterOut) :
    x * y * supply^2 ≤ afterIn * afterOut * supply^2 := by
  have product : x * y ≤ (x + gross) * (y - out) := by
    cases quote with
    | inl h => exact exactInputProduct _ _ _ _ _ hx hy hg hf h
    | inr h => exact exactOutputProduct _ _ _ _ _ hx hy ho hg hf h
  exact reserveSurplus _ _ _ _ _ _ _ _ (Nat.mul_le_mul_right _ product) credit debit

end Inv37Source

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Quot.sound, ``Lean.ofReduceBool, ``Lean.trustCompiler]
  for name in #[``Inv37Source.addition, ``Inv37Source.removal, ``Inv37Source.donation,
      ``Inv37Source.swapBacking] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-37 axiom {dep}"
