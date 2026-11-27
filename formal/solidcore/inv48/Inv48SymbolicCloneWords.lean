import Inv48SymbolicCloneCore
open SolidCore.Solidity.Source
open SolidCore.Solidity
namespace Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
abbrev R := 2^256

private theorem toEvm (n : Nat) (h : n < R) : Shared.toEvmWord n = ⟨⟨n,h⟩⟩ := by
  apply congrArg EvmYul.UInt256.mk
  apply Fin.ext
  change (n%R)%R = n
  simp [Nat.mod_eq_of_lt h]
private theorem fromEvm (a : Fin (2^256)) : Shared.ofEvmWord ⟨a⟩ = a.val := Nat.mod_eq_of_lt a.isLt

theorem or_value (checked : Bool) (a b : Nat) (ha : a < R) (hb : b < R) :
    BinaryOp.apply checked .bitOr (.word a) (.word b) = .ok (.word (a ||| b)) := by
  have h : Shared.orWord a b = a ||| b := by
    unfold Shared.orWord Shared.liftEvmBinary
    rw [toEvm a ha, toEvm b hb, EvmYul.UInt256.lor, fromEvm]
    change (a ||| b)%R = _
    exact Nat.mod_eq_of_lt (Nat.or_lt_two_pow ha hb)
  simp [BinaryOp.apply, Value.forceAbiLazy, BinaryOp.applyWord, h,
    BinaryOp.preservesFixedBytesWidth, Bind.bind, Except.bind]

theorem shl_value (checked : Bool) (a : Nat) (ha : a < R) (fits : a*256 < R) :
    BinaryOp.apply checked .shl (.word a) (.word 8) = .ok (.word (a*256)) := by
  have h : Shared.shlWord 8 a = a*256 := by
    unfold Shared.shlWord
    rw [toEvm a ha, toEvm 8 (by decide), EvmYul.UInt256.shiftLeft]
    rw [fromEvm]
    change (a <<< 8)%R = _
    simpa [Nat.shiftLeft_eq] using Nat.mod_eq_of_lt fits
  simp [BinaryOp.apply, Value.forceAbiLazy, BinaryOp.applyWord, h,
    BinaryOp.preservesFixedBytesWidth, Bind.bind, Except.bind]

theorem lt_value (checked : Bool) (a b : Nat) (ha : a < R) (hb : b < R) :
    BinaryOp.apply checked .lt (.word a) (.word b) = .ok (.word (if a < b then 1 else 0)) := by
  have h : Shared.ltWord a b = if a < b then 1 else 0 := by
    unfold Shared.ltWord Shared.liftEvmBinary
    rw [toEvm a ha, toEvm b hb, EvmYul.UInt256.lt]
    have cmp : (EvmYul.UInt256.mk ⟨a,ha⟩ < EvmYul.UInt256.mk ⟨b,hb⟩) ↔ a < b := Iff.rfl
    simp only [cmp]
    by_cases ab : a < b <;> simp [ab] <;> rfl
  simp [BinaryOp.apply, Value.forceAbiLazy, BinaryOp.applyWord, h,
    BinaryOp.preservesFixedBytesWidth, Bind.bind, Except.bind]
theorem cast_value (width a : Nat) (positive : 0 < width) (small : width ≤ 256)
    (ha : a < 2^width) : uintCast? width (.word a) = .ok (.word a) := by
  have ar : a < R := lt_of_lt_of_le ha (Nat.pow_le_pow_right (by decide) small)
  simp [uintCast?, Value.forceAbiLazy, Value.asStorageWord?, positive, small,
    Shared.norm, show Shared.wordModulus = R from rfl,
    Nat.mod_eq_of_lt ar, Nat.mod_eq_of_lt ha, Bind.bind, Except.bind]

theorem cleanup_value (checked : Bool) (a : Nat) (ha : a < R) :
    uintCleanup? checked 256 (.word a) = .ok (.word a) := Inv32Guards.cleanupWord checked a ha

theorem add_value (checked : Bool) (a b : Nat) (ha : a < R) (hb : b < R)
    (fits : a+b < R) :
    BinaryOp.apply checked .add (.word a) (.word b) = .ok (.word (a+b)) := by
  have v : Shared.addWord a b = a+b := by
    unfold Shared.addWord Shared.liftEvmBinary
    rw [toEvm a ha, toEvm b hb, EvmYul.UInt256.add, fromEvm]
    exact Nat.mod_eq_of_lt fits
  simp [BinaryOp.apply, Value.forceAbiLazy, BinaryOp.applyWord, checkedAdd,
    Shared.norm, show Shared.wordModulus = R from rfl, show wordModulus = R from rfl,
    Nat.mod_eq_of_lt ha, Nat.mod_eq_of_lt hb, v,
    show ¬ R ≤ a+b from Nat.not_le_of_gt fits,
    BinaryOp.preservesFixedBytesWidth, Bind.bind, Except.bind]

end Inv48.SymbolicClone
