import Inv48SymbolicCloneStep
import Inv48SymbolicCloneRefState
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
set_option linter.unusedSimpArgs false
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem liftOk {α : Type} (a : α) : (liftM (.ok a : Except RevertData α) : SolI α) = pure a := rfl
theorem ref_word_rhs (n : Nat) (c : Context) (r : Runtime) (code : List Nat) (i acc b id : Nat)
    (len : code.length = 96) (hi : i < 51) (hb : b < 256)
    (fit : acc*256+b < R)
    (byteAt : listGet? (code.map normByte) (45+i) = some b)
    (W : r.lookupLocal? "#extword" = some (.word acc))
    (I : r.lookupLocal? "#extindex" = some (.word i))
    (C : r.lookupLocal? "#extcode" = some (.memoryRef id))
    (M : r.loadMemory? id = some (.bytes code))
    (O : r.lookupLocal? "offset" = some (.word 45)) :
    Expr.evalFuel (n+14) c r nextWord = pure (.word (acc*256+b),r) := by
  have ir : i < R := lt_trans hi (by decide)
  have ar : acc < R := by omega
  have shiftFit : acc*256 < R := by omega
  have br : b < R := lt_trans hb (by decide)
  have idxFit : 45+i < R := lt_trans (by omega : 45+i < 96) (by decide)
  have bitEq : (acc*256) ||| b = acc*256+b := by
    simpa [Nat.shiftLeft_eq] using Inv48.CloneRead.bitwise_step acc b hb
  simp [nextWord, byteGuard, byteRead, clean, cast, Expr.evalFuel,
    Expr.evalListFuel, Expr.hasStorageRoot, Expr.hasStorageRefRoot,
    Runtime.lookupStorageBase?, W,I,C,M,O, Runtime.derefMemoryValue,
    Value.length?, Value.expectWord, pb, liftOk, len,
    cleanup_value _ i ir, cleanup_value _ 45 (by decide),
    cleanup_value _ 96 (by decide), cleanup_value _ 51 (by decide),
    cleanup_value _ b br, cleanup_value _ (acc*256+b) fit,
    cast_value 8 b (by decide) (by decide) hb,
    cast_value 256 (acc*256) (by decide) (by decide) shiftFit,
    add_value _ 45 i (by decide) ir idxFit,
    lt_value _ 45 96 (by decide) (by decide),
    lt_value _ i 51 ir (by decide), hi,
    shl_value _ acc ar shiftFit,
    or_value _ (acc*256) b shiftFit br,
    ir, ar, br, shiftFit, idxFit, fit, hb, bitEq,
    Value.index?, byteAt, normWord, SolidCore.Solidity.Shared.norm,
    SolidCore.Solidity.Shared.wordModulus, EvmYul.UInt256.size, wordTruthy, boolWord, R,
    Nat.mod_eq_of_lt ir, Nat.mod_eq_of_lt idxFit,
    show BinaryOp.apply c.checked .sub (.word 96) (.word 45) = .ok (.word 51) by cases c.checked <;> rfl]
  norm_num [R] at idxFit
  rw [Nat.mod_eq_of_lt idxFit]
  simp only [byteAt, liftOk, pb,
    Runtime.derefMemoryValue, cast_value 8 b (by decide) (by decide) hb,
    cleanup_value _ b br, W, Runtime.lookupStorageBase?,
    shl_value _ acc ar shiftFit,
    cast_value 256 (acc*256) (by decide) (by decide) shiftFit,
    or_value _ (acc*256) b shiftFit br, bitEq,
    cleanup_value _ (acc*256+b) fit]
end Inv48.SymbolicClone
