import Inv48SymbolicCloneCanonical
import Inv48SymbolicCloneRefRun
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
open Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
/-- Universal actual execution of the first complete generated loop, not a numeric witness.
`base` is arbitrary; the decoder frame fixes only offset, cached code, index and accumulator.
This theorem's statement is about the real `Stmt.eval`, with one interpreter iteration per byte.
The separate `checked_library` certificate identifies this loop in the checked library body. -/
theorem first_loop_ref (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) :
    Stmt.eval (n+35) table c
      (refState base (runtimeCode implementation universeBytes token) 0 0) firstLoop =
      pure (.normal (refState base (runtimeCode implementation universeBytes token) 31
        (decode universeBytes))) := by
  have result := ref_loop_eval universeBytes n table c base (runtimeCode implementation universeBytes token)
    0 0 31 (canonical_length _ _ _ hi hu ht) (by decide) (by omega) cu
    (by simpa [loop_invariant] using accumulator_fits universeBytes (by omega) cu)
    (first_reads implementation universeBytes token hi cu)
  rw [hu] at result
  simpa only [Stmt.eval, firstLoop, loop_invariant, Nat.zero_mul, Nat.zero_add] using result

theorem second_loop_ref (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (ct : ∀ b ∈ token, b < 256) :
    Stmt.eval (n+24) table c
      (refState base (runtimeCode implementation universeBytes token) 31 0) secondLoop =
      pure (.normal (refState base (runtimeCode implementation universeBytes token) 51
        (decode token))) := by
  have result := ref_loop_eval token n table c base (runtimeCode implementation universeBytes token)
    31 0 51 (canonical_length _ _ _ hi hu ht) (by decide) (by omega) ct
    (by simpa [loop_invariant] using accumulator_fits token (by omega) ct)
    (second_reads implementation universeBytes token hi hu ct)
  rw [ht] at result
  simpa only [Stmt.eval, secondLoop, loop_invariant, Nat.zero_mul, Nat.zero_add] using result

end Inv48.SymbolicClone
