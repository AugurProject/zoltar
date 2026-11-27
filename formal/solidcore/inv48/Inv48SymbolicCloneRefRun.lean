import Inv48SymbolicCloneRefStep
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
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
end Inv48.SymbolicClone

namespace Inv48.SymbolicClone

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
end Inv48.SymbolicClone
