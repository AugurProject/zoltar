import Inv48EscrowDecodeCore
open SolidCore.Solidity.Source
namespace Inv48.EscrowDecode
set_option maxRecDepth 65536
set_option maxHeartbeats 800000

theorem wordsLength (xs : List Nat) :
    (xs.flatMap (wordToBytesBE 32)).length = xs.length * 32 := by
  induction xs with
  | nil => rfl
  | cons x xs ih => simp [Inv48.Minima.wordLength, ih, Nat.add_mul, Nat.add_comm]

theorem readWords (xs : List Nat) (i v : Nat) (item : xs[i]? = some v)
    (fit : v < 2^256) :
    ABI.readWord? (xs.flatMap (wordToBytesBE 32)) (32*i) = some v := by
  have dropWords : ∀ (xs : List Nat) (i : Nat),
      (xs.flatMap (wordToBytesBE 32)).drop (32*i) =
        ((xs.drop i).flatMap (wordToBytesBE 32)) := by
    intro xs i
    induction i generalizing xs with
    | zero => simp
    | succ i ih =>
      cases xs with
      | nil => simp
      | cons x xs =>
        simp only [List.flatMap_cons, Nat.mul_succ]
        rw [show 32*i+32 = 32+32*i by omega, ← List.drop_drop]
        rw [List.drop_left' (Inv48.Minima.wordLength 32 x)]
        exact ih xs
  have head : (xs.drop i).head? = some v := by simpa using item
  cases eq : xs.drop i with
  | nil => simp [eq] at head
  | cons x rest =>
    simp only [eq,List.head?_cons,Option.some.injEq] at head
    subst x
    unfold ABI.readWord? ABI.readBytes?
    simp only [ABI.wordBytes]
    rw [dropWords, eq]
    simp only [List.flatMap_cons]
    rw [if_pos (by simp [Inv48.Minima.wordLength])]
    rw [List.take_append_of_le_length (by rw [Inv48.Minima.wordLength]),
      List.take_of_length_le (by rw [Inv48.Minima.wordLength])]
    have norm (bs : List Byte) : ABI.normalizeBytes bs = bs.map normByte := rfl
    have word (bs : List Byte) : ABI.bytesToWordBE bs = bytesToWordBE bs := rfl
    rw [norm, Inv12.bytesClean]
    change some (ABI.bytesToWordBE (wordToBytesBE 32 v)) = some v
    rw [word, Inv48.Minima.canonicalWord v fit]
end Inv48.EscrowDecode
