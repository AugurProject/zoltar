import Inv08AuthorityShapes
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Authority
/-- The runtime may take account code from an adopted world or from the external call context. -/
def bytes (c : Context) (r : Runtime) := r.state.envAccountCode c (normWord c.self)
def byteAt (code : List Nat) (i : Nat) := normByte (code[45+i]?.getD 0)
/-- Big-endian decoding of the first i address bytes after the 45-byte clone runtime. -/
def prefixWord (code : List Nat) : Nat → Nat
  | 0 => 0
  | i+1 => prefixWord code i * 256 + byteAt code i
def Clone (c : Context) (r : Runtime) := (bytes c r).length=65 ∧ c.sender=prefixWord (bytes c r) 20
def post (c : Context) (r : Runtime) := (r.allocMemory (.bytes (bytes c r))).1

theorem byteBound (code : List Nat) (i : Nat) : byteAt code i < 256 := Nat.mod_lt _ (by decide)
theorem prefixBound (code : List Nat) (i : Nat) : prefixWord code i < 2^(8*i) := by
  induction i with
  | zero => change 0<1; decide
  | succ n ih =>
    change prefixWord code n*256+byteAt code n < _
    rw [show 8*(n+1)=8*n+8 by omega,Nat.pow_add]
    exact lt_of_lt_of_le (Nat.add_lt_add_left (byteBound code n) _) (by
      change prefixWord code n * 256 + 256 ≤ 2^(8*n)*256
      simpa [Nat.succ_mul] using Nat.mul_le_mul_right 256 ih)
theorem prefixWordBound (code : List Nat) (i : Nat) (small : i≤20) : prefixWord code i < R :=
  lt_of_lt_of_le (prefixBound _ _) (Nat.pow_le_pow_right (by decide) (by omega))
theorem byteLookup (xs : List Nat) (i : Nat) (inside : i<xs.length) :
    listGet? (xs.map normByte) i = some (normByte (xs[i]?.getD 0)) := by
  induction xs generalizing i with
  | nil => simp at inside
  | cons x xs ih =>
    cases i with
    | zero => rfl
    | succ i =>
      simpa [listGet?] using ih i (by simp at inside; omega)
private theorem evm (v : Nat) (hv : v<R) : Shared.toEvmWord v = ⟨⟨v,hv⟩⟩ := by
  apply congrArg EvmYul.UInt256.mk
  apply Fin.ext
  change (v%R)%R=v
  simp [Nat.mod_eq_of_lt hv]
theorem shiftEight (checked : Bool) (v : Nat) (fit : v*256<R) :
    Source.BinaryOp.apply checked .shl (.word v) (.word 8) = .ok (.word (v*256)) := by
  have small : v<R := by omega
  have shift : Shared.shlWord 8 v=v*256 := by
    unfold Shared.shlWord
    rw [evm v small,evm 8 (by decide)]
    change (((v <<< 8)%R)%R) = _
    simp [Nat.shiftLeft_eq,Nat.mod_eq_of_lt fit]
  simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,Source.BinaryOp.applyWord,shift,Bind.bind,Except.bind]
theorem combine (checked : Bool) (v b : Nat) (fit : v*256<R) (small : b<256) :
    Source.BinaryOp.apply checked .bitOr (.word (v*256)) (.word b) = .ok (.word (v*256+b)) := by
  have calcOr := Inv32WideWords.orWord (BitVec.ofNat 256 (v*256)) (BitVec.ofNat 256 b)
  have hw : b<R := lt_trans small (by decide)
  simp only [BitVec.toNat_or, BitVec.toNat_ofNat, Nat.mod_eq_of_lt fit,Nat.mod_eq_of_lt hw] at calcOr
  have eqn := Nat.shiftLeft_add_eq_or_of_lt (i:=8) (by exact small) v
  rw [Nat.shiftLeft_eq] at eqn
  change v*256+b=v*256 ||| b at eqn
  rw [←eqn] at calcOr
  exact calcOr
end Inv08.Authority
