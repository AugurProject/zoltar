import Inv32Proved

/-!
# INV-33 — splitting a same-direction exact-input quote

The second call uses the first swap's resulting reserves. The input reserve gains
the entire gross input, including its fee. Both calls use the same fee rate.
-/

namespace Inv33Source
open Inv32
open Inv32Source (returnsAmount forwardRefines)

private theorem netSuperadditive (a b fee : Nat) :
    netInput a fee + netInput b fee ≤ netInput (a + b) fee := by
  unfold netInput
  apply (Nat.le_div_iff_mul_le (by decide : 0 < bps)).mpr
  rw [Nat.add_mul, Nat.add_mul]
  exact Nat.add_le_add (Nat.div_mul_le_self _ _) (Nat.div_mul_le_self _ _)

/-- A successful generated call supplies the floor inequality for its output. -/
private theorem leg (x y gross fee out : Nat)
    (hx : x < word) (hy : y < word) (hg : gross < word) (hf : fee < word)
    (success : returnsAmount "quoteExactInput" x y gross fee out) :
    0 < x ∧ 0 < out ∧ out < y ∧ fee < bps ∧
    out * (x + netInput gross fee) ≤ y * netInput gross fee := by
  have h := (forwardRefines x y gross fee out hx hy hg hf).mp success
  unfold quoteExactInput at h
  dsimp only at h
  split at h
  next valid =>
    obtain ⟨xp, _, _, fb, _, op, oy⟩ := valid
    injection h with eq
    subst out
    refine ⟨xp, op, oy, fb, ?_⟩
    rw [ratio_correct _ _ _ hy (lt_of_le_of_lt (Inv32ForwardSteps.netBound _ _) hg) hx (by omega)]
    exact Nat.div_mul_le_self _ _
  next => contradiction

/-- If both split quotes return, the single quote also returns and pays at
least their combined output, for every representable set of quote arguments. -/
theorem splitExactInput (x y a b fee u v : Nat)
    (hreserve : x + a < word) (hy : y < word) (htotal : a + b < word) (hf : fee < word)
    (first : returnsAmount "quoteExactInput" x y a fee u)
    (second : returnsAmount "quoteExactInput" (x + a) (y - u) b fee v) :
    ∃ out, returnsAmount "quoteExactInput" x y (a + b) fee out ∧ u + v ≤ out := by
  let na := netInput a fee
  let nb := netInput b fee
  let n := netInput (a + b) fee
  obtain ⟨xp, up, uy, fb, hu⟩ := leg _ _ _ _ _ (by omega) hy (by omega) hf first
  obtain ⟨_, vp, vy, _, hv⟩ := leg _ _ _ _ _ hreserve (by omega) (by omega) hf second
  change u * (x + na) ≤ y * na at hu
  change v * (x + a + nb) ≤ (y - u) * nb at hv
  have feeRetained := Nat.mul_le_mul_left v (Inv32ForwardSteps.netBound a fee)
  change v * na ≤ v * a at feeRetained
  have balance : (y - u) * nb + u * nb = y * nb := by
    rw [← Nat.add_mul, Nat.sub_add_cancel (by omega)]
  have splitBound : (u + v) * (x + (na + nb)) ≤ y * (na + nb) := by
    simp only [Nat.add_mul, Nat.mul_add] at hu hv ⊢
    omega
  have super : na + nb ≤ n := netSuperadditive a b fee
  have extra := Nat.mul_le_mul_right (n - (na + nb)) (show u + v ≤ y by omega)
  have totalBound : (u + v) * (x + n) ≤ y * n := by
    calc
      _ = (u + v) * (x + (na + nb)) + (u + v) * (n - (na + nb)) := by
        rw [← Nat.mul_add]; congr 1; omega
      _ ≤ y * (na + nb) + y * (n - (na + nb)) := Nat.add_le_add splitBound extra
      _ = y * n := by rw [← Nat.mul_add]; congr 1; omega
  let out := y * n / (x + n)
  have enough : u + v ≤ out := (Nat.le_div_iff_mul_le (by omega)).mpr totalBound
  have below : out < y := by
    apply (Nat.div_lt_iff_lt_mul (by omega)).mpr
    rw [Nat.mul_add]
    have := Nat.mul_pos (show 0 < y by omega) xp
    omega
  have np : 0 < n := by
    by_contra! zero
    have : out = 0 := by simp [out, show n = 0 by omega]
    omega
  have ng : n ≤ a + b := Inv32ForwardSteps.netBound _ _
  refine ⟨out, (forwardRefines _ _ _ _ _ (by omega) hy htotal hf).mpr ?_, enough⟩
  unfold quoteExactInput
  change (if 0 < x ∧ 0 < y ∧ 0 < a+b ∧ fee < bps ∧ 0 < n ∧
    0 < ratio y n x ∧ ratio y n x < y then some (ratio y n x) else none) = some out
  rw [ratio_correct _ _ _ hy (by omega) (by omega) (by omega), if_pos]
  change _ ∧ _ ∧ _ ∧ _ ∧ _ ∧ 0 < out ∧ out < y
  exact ⟨xp, by omega, by omega, fb, np, by omega, below⟩

end Inv33Source

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Lean.ofReduceBool, ``Lean.trustCompiler, ``Quot.sound]
  for dep in ← collectAxioms ``Inv33Source.splitExactInput do
    unless allowed.contains dep do throwError "Unexpected axiom {dep} in INV-33"

#print axioms Inv33Source.splitExactInput
