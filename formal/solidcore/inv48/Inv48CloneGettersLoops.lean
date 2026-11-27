import Inv48SymbolicCloneBoundary
import Inv48SymbolicCloneLink
open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
set_option linter.unusedSimpArgs false

def refState (base : Runtime) (code : List Nat) (i acc : Nat) : Runtime :=
  { (base.allocMemory (.bytes code)).1 with
    locals := [("#extword", .word acc), ("#extindex", .word i),
      ("#extcode", .memoryRef base.nextMemory)] :: [("offset", .word 45)] :: base.locals }

@[simp] theorem ref_lookup (base : Runtime) (code : List Nat) (i acc : Nat) (name : String) :
    (refState base code i acc).lookupLocal? name =
      if name = "#extword" then some (.word acc) else
      if name = "#extindex" then some (.word i) else
      if name = "#extcode" then some (.memoryRef base.nextMemory) else
      if name = "offset" then some (.word 45) else base.lookupLocal? name := by
  by_cases a : name = "#extword" <;> by_cases b : name = "#extindex" <;>
    by_cases d : name = "#extcode" <;> by_cases e : name = "offset" <;>
    simp_all [refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?, eq_comm]

@[simp] theorem ref_memory (base : Runtime) (code : List Nat) (i acc : Nat) :
    (refState base code i acc).loadMemory? base.nextMemory = some (.bytes code) := by
  simp [refState, Runtime.allocMemory, Runtime.loadMemory?, MemoryMap.lookup?, MemoryMap.insertLoop]
@[simp] theorem push_memory (r : Runtime) (id : Nat) :
    r.pushScope.loadMemory? id = r.loadMemory? id := rfl
theorem ref_store_word (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (refState base code i acc).assignLocal? "#extword" (.word v) =
      some (refState base code i v) := by
  simp [Runtime.assignLocal?, refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]

theorem ref_store_index (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (refState base code i acc).assignLocal? "#extindex" (.word v) =
      some (refState base code v acc) := by
  simp [Runtime.assignLocal?, refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]
theorem ref_store_word_scoped (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (refState base code i acc).pushScope.assignLocal? "#extword" (.word v) =
      some (refState base code i v).pushScope := by
  simp [Runtime.pushScope, Runtime.assignLocal?, refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]

theorem ref_store_index_scoped (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (refState base code i acc).pushScope.assignLocal? "#extindex" (.word v) =
      some (refState base code v acc).pushScope := by
  simp [Runtime.pushScope, Runtime.assignLocal?, refState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]
end Inv48.CloneGetters


open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem ref_iteration_eval (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (code : List Nat) (i acc b : Nat)
    (len : code.length = 96) (hi : i < 51) (hb : b < 256)
    (fit : acc*256+b < R)
    (byteAt : listGet? (code.map normByte) (45+i) = some b) :
    Stmt.eval (n+2) table c (refState base code i acc) iteration =
      pure (.normal (refState base code (i+1) (acc*256+b))) := by
  have w : Stmt.eval (n+1) table c (refState base code i acc).pushScope
      (.assign (.var "#extword") nextWord) =
      pure (.normal (refState base code i (acc*256+b)).pushScope) := by
    apply Inv32Assign.scalarCast n table c _ _ "#extword" acc (acc*256+b) .uintCleanup 256 _
    · simp
    · exact ref_word_rhs (nextWord.orderFuel-13) c _ code i acc b base.nextMemory len hi hb fit byteAt
        (by simp) (by simp) (by simp) (by simp) (by simp)
    · exact ref_store_word_scoped _ _ _ _ _
  have ix : Stmt.eval (n+1) table c (refState base code i (acc*256+b)).pushScope
      (.assign (.var "#extindex") nextIndex) =
      pure (.normal (refState base code (i+1) (acc*256+b)).pushScope) := by
    apply Inv32Assign.scalarCast n table c _ _ "#extindex" i (i+1) .uintCleanup 256 _
    · simp
    · exact index_rhs (nextIndex.orderFuel-4) c _ i hi (by simp)
    · exact ref_store_index_scoped _ _ _ _ _
  unfold iteration
  rw [Stmt.eval]
  dsimp only
  rw [Stmt.evalList,w]
  simp only [pb]
  rw [Stmt.evalList,ix]
  simp only [pb,Stmt.evalList]
  rfl
end Inv48.CloneGetters

namespace Inv48.CloneGetters
open Inv48.SymbolicClone

theorem ref_fold_ge (bs : List Nat) (acc : Nat) :
    acc ≤ bs.foldl (fun a b => a*256+b) acc := by
  induction bs generalizing acc with
  | nil => rfl
  | cons b bs ih => exact le_trans (by omega : acc ≤ acc*256+b) (ih _)

/-- One recursive `evalWhile` layer per byte, using the checked lowered iteration.
The arbitrary base supplies state, scratch and outer local frames; the cached code
uses the interpreter's actual memory allocation and reference lookup. -/
theorem ref_loop_eval (bs : List Nat) (n : Nat) (table : FunctionTable) (c : Context)
    (base : Runtime) (code : List Nat) (i acc stop : Nat)
    (len : code.length = 96) (stopBound : stop ≤ 51) (endAt : i+bs.length = stop)
    (cleanBytes : ∀ b ∈ bs, b < 256)
    (fits : bs.foldl (fun a b => a*256+b) acc < R)
    (reads : ∀ j b, listGet? bs j = some b →
      listGet? (code.map normByte) (45+i+j) = some b) :
    Stmt.evalWhile (n+bs.length+3) table c (refState base code i acc) (guard stop) iteration =
      pure (.normal (refState base code stop (bs.foldl (fun a b => a*256+b) acc))) := by
  induction bs generalizing i acc with
  | nil =>
    have eq : i = stop := by simpa using endAt
    subst i
    have g : Expr.eval c (refState base code stop acc) (guard stop) = pure (.word 0,refState base code stop acc) := by
      exact (guard_rhs ((guard stop).orderFuel-2) c _ stop stop
        (lt_of_le_of_lt stopBound (by decide))
        (lt_of_le_of_lt stopBound (by decide)) (by simp)).trans (by simp)
    rw [show n + ([] : List Nat).length + 3 = (n+2)+1 by simp, Stmt.evalWhile, g]
    rfl
  | cons b bs ih =>
    have hi : i < 51 := by simp only [List.length_cons] at endAt; omega
    have nextFit : acc*256+b < R := lt_of_le_of_lt (ref_fold_ge bs _) fits
    have g : Expr.eval c (refState base code i acc) (guard stop) = pure (.word 1,refState base code i acc) := by
      have h := guard_rhs ((guard stop).orderFuel-2) c (refState base code i acc) i stop
        (lt_trans hi (by decide)) (lt_of_le_of_lt stopBound (by decide)) (by simp)
      have yes : i < stop := by simp only [List.length_cons] at endAt; omega
      simpa [yes] using h
    have step := ref_iteration_eval (n+bs.length+1) table c base code i acc b len hi
      (cleanBytes b (by simp)) nextFit (by simpa using reads 0 b rfl)
    have recurse :=  ih (i+1) (acc*256+b) (by simp only [List.length_cons] at endAt; omega)
      (by intro x hx; exact cleanBytes x (by simp [hx])) fits
      (by
        intro j x hx
        have h := reads (j+1) x hx
        simpa [Nat.add_assoc, Nat.add_comm, Nat.add_left_comm] using h)
    rw [show n+(b::bs).length+3 = (n+bs.length+3)+1 by simp only [List.length_cons]; omega, Stmt.evalWhile, g]
    change (do
      match ← Stmt.eval (n+bs.length+3) table c (refState base code i acc) iteration with
      | .normal r => Stmt.evalWhile (n+bs.length+3) table c r (guard stop) iteration
      | .continued r => Stmt.evalWhile (n+bs.length+3) table c r (guard stop) iteration
      | .broke r => pure (.normal r)
      | result => pure result) = _
    rw [show n+bs.length+3 = (n+bs.length+1)+2 by omega, step]
    exact recurse
end Inv48.CloneGetters

open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone
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

end Inv48.CloneGetters
