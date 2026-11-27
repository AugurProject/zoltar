import Inv48SymbolicCloneRun
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
open Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000

theorem get_drop (xs : List Nat) (n j : Nat) :
    listGet? (xs.drop n) j = listGet? xs (n+j) := by
  induction n generalizing xs with
  | zero => simp
  | succ n ih =>
    cases xs with
    | nil => simp [listGet?]
    | cons x xs => simpa [listGet?, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm] using ih xs

theorem get_append (xs ys : List Nat) (j b : Nat) (h : listGet? xs j = some b) :
    listGet? (xs++ys) j = some b := by
  induction xs generalizing j with
  | nil => simp [listGet?] at h
  | cons x xs ih =>
    cases j with
    | zero => exact h
    | succ j => exact ih j h

theorem map_clean (xs : List Nat) (h : ∀ b ∈ xs, b < 256) : xs.map normByte = xs := by
  induction xs with
  | nil => rfl
  | cons b bs ih =>
    have hb : normByte b = b := Nat.mod_eq_of_lt (h b (by simp))
    simp only [List.map_cons, hb, ih (by intro x hx; exact h x (by simp [hx]))]

theorem first_reads (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (cleanBytes : ∀ b ∈ universeBytes, b < 256) :
    ∀ j b, listGet? universeBytes j = some b →
      listGet? ((runtimeCode implementation universeBytes token).map normByte) (45+0+j) = some b := by
  intro j b h
  rw [Nat.add_zero, ← get_drop _ 45 j, ← List.map_drop,
    canonical_payload implementation universeBytes token hi, List.map_append,
    map_clean universeBytes cleanBytes]
  exact get_append _ _ j b h

/-- Universal actual execution of the first complete generated loop, not a numeric witness.
`base` is arbitrary; the decoder frame fixes only offset, cached code, index and accumulator.
This theorem's statement is about the real `Stmt.eval`, with one interpreter iteration per byte.
The separate `checked_library` certificate identifies this loop in the checked library body. -/
theorem first_loop (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) :
    Stmt.eval (n+35) table c
      (loopState base (runtimeCode implementation universeBytes token) 0 0) firstLoop =
      pure (.normal (loopState base (runtimeCode implementation universeBytes token) 31
        (decode universeBytes))) := by
  have result := loop_eval universeBytes n table c base (runtimeCode implementation universeBytes token)
    0 0 31 (canonical_length _ _ _ hi hu ht) (by decide) (by omega) cu
    (by simpa [loop_invariant] using accumulator_fits universeBytes (by omega) cu)
    (first_reads implementation universeBytes token hi cu)
  rw [hu] at result
  simpa only [Stmt.eval, firstLoop, loop_invariant, Nat.zero_mul, Nat.zero_add] using result

theorem second_reads (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31)
    (ct : ∀ b ∈ token, b < 256) :
    ∀ j b, listGet? token j = some b →
      listGet? ((runtimeCode implementation universeBytes token).map normByte) (45+31+j) = some b := by
  intro j b h
  have dropToken : (runtimeCode implementation universeBytes token).drop 76 = token := by
    have hx := (canonical_slices implementation universeBytes token hi hu).2
    simpa only [List.drop_drop] using hx
  rw [show 45+31+j = 76+j by omega, ← get_drop _ 76 j, ← List.map_drop,
    dropToken, map_clean token ct]
  exact h

theorem second_loop (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (ct : ∀ b ∈ token, b < 256) :
    Stmt.eval (n+24) table c
      (loopState base (runtimeCode implementation universeBytes token) 31 0) secondLoop =
      pure (.normal (loopState base (runtimeCode implementation universeBytes token) 51
        (decode token))) := by
  have result := loop_eval token n table c base (runtimeCode implementation universeBytes token)
    31 0 51 (canonical_length _ _ _ hi hu ht) (by decide) (by omega) ct
    (by simpa [loop_invariant] using accumulator_fits token (by omega) ct)
    (second_reads implementation universeBytes token hi hu ct)
  rw [ht] at result
  simpa only [Stmt.eval, secondLoop, loop_invariant, Nat.zero_mul, Nat.zero_add] using result

end Inv48.SymbolicClone
