import Inv45Arithmetic
import Inv08AuthorityExpressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Signed
abbrev H : Nat := 2^255
def inRange (v : Int) : Prop := -(H:Int)≤v ∧ v<(H:Int)
def word (v : Int) : Nat := if v<0 then (v+(R:Int)).toNat else v.toNat
theorem wordFit (v : Int) (bounds : inRange v) : word v<R := by
  obtain ⟨lo,hi⟩ := bounds
  unfold word; split <;> norm_num [H,R] at * <;> omega
theorem evm (w : Nat) (fit : w<R) : Shared.toEvmWord w=⟨⟨w,fit⟩⟩ := by
  apply congrArg EvmYul.UInt256.mk;apply Fin.ext
  change (w%R)%R=w;simp [Nat.mod_eq_of_lt fit]
private theorem complement (w : Nat) (fit : w<R) : (R-1) ^^^ w=R-1-w := by
  let b := BitVec.ofNat 256 w
  have h := congrArg BitVec.toNat (BitVec.allOnes_xor (x:=b))
  simpa only [BitVec.toNat_xor,BitVec.toNat_allOnes,BitVec.toNat_not,b,BitVec.toNat_ofNat,Nat.mod_eq_of_lt fit] using h

theorem decode (w : Nat) (fit : w<R) : Shared.signedValue w = if w<H then (w:Int) else (w:Int)-(R:Int) := by
  unfold Shared.signedValue EvmYul.UInt256.fromSigned
  rw [evm w fit]
  change (if w<H then (w:Int) else -((R-1 ^^^ w):Nat) - 1)=_
  rw [complement w fit]
  split <;> norm_num [H,R] at * <;> omega

theorem decodeWord (v : Int) (bounds : inRange v) : Shared.signedValue (word v)=v := by
  rw [decode _ (wordFit _ bounds)]
  obtain ⟨lo,hi⟩ := bounds
  unfold word; split <;> split <;> norm_num [H,R] at * <;> omega

theorem encode (v : Int) (bounds : inRange v) : Shared.signedToWord v=word v := by
  obtain ⟨lo,hi⟩ := bounds
  cases v with
  | ofNat k =>
    have fit : k<R := by norm_num [H,R] at *;omega
    change (k%R)%R=_
    simp [word,Nat.mod_eq_of_lt fit]
  | negSucc k =>
    have fit : R-1-k<R := by norm_num [R];omega
    change ((R-1-k)%R)%R=_
    simp only [Nat.mod_eq_of_lt fit]
    unfold word;split <;> norm_num [H,R] at * <;> omega

theorem clean (check : Bool) (v : Int) (bound : inRange v) :
    intCleanup? check 256 (.int (word v))=.ok (.int (word v)) := by
  have W := wordFit v bound
  have S := decodeWord v bound
  have N : Shared.norm (word v)=word v := Nat.mod_eq_of_lt W
  have lo : ¬ v < -(H:Int) := Int.not_lt.mpr bound.1
  have hi : ¬ (H-1:Nat) < v := by have := bound.2;norm_num [H] at *;omega
  simp [intCleanup?,intCast?,Value.forceAbiLazy,Value.asStorageWord?,Bind.bind,Except.bind,S,N]
  change (if check = true ∧ (v < -(H:Int) ∨ ((H-1:Nat):Int) < v) then _ else Except.ok (Value.int (if H ≤ word v % R then Shared.norm (wordModulus-R+word v % R) else Shared.norm (word v % R)))) = _
  simp [lo,hi,Nat.mod_eq_of_lt W,show wordModulus-R=0 from rfl,N]
  intro _;norm_num [H] at lo hi;omega
end Inv45.Signed
