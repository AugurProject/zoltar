import Inv44Shape
import Inv44Bits
import Inv08AuthorityExpressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44
private theorem evm (v : Nat) (hv : v<R) : Shared.toEvmWord v = ⟨⟨v,hv⟩⟩ := by
  apply congrArg EvmYul.UInt256.mk
  apply Fin.ext
  change (v%R)%R=v
  simp [Nat.mod_eq_of_lt hv]
theorem oneShift (checked : Bool) (i : Nat) (hi : i<256) :
    Source.BinaryOp.apply checked .shl (.word 1) (.word i) = .ok (.word (2^i)) := by
  have fit : 2^i<R := Nat.pow_lt_pow_right (by decide) hi
  have shift : Shared.shlWord i 1=2^i := by
    unfold Shared.shlWord
    rw [evm 1 (by decide),evm i (lt_trans hi (by decide))]
    unfold EvmYul.UInt256.shiftLeft
    rw [if_neg (by change ¬256≤i;omega)]
    change (((1 <<< i)%R)%R) = _
    simp [Nat.shiftLeft_eq,Nat.mod_eq_of_lt fit]
  simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,Source.BinaryOp.applyWord,shift,Bind.bind,Except.bind]
theorem wordOr (checked : Bool) (x y : Nat) (hx : x<R) (hy : y<R) :
    Source.BinaryOp.apply checked .bitOr (.word x) (.word y) = .ok (.word (x ||| y)) := by
  change Source.BinaryOp.apply false .bitOr _ _ = _
  have h := Inv32WideWords.orWord (BitVec.ofNat 256 x) (BitVec.ofNat 256 y)
  simpa only [BitVec.toNat_or,BitVec.toNat_ofNat,Nat.mod_eq_of_lt hx,Nat.mod_eq_of_lt hy] using h

theorem includeBit (n : Nat) (c : Context) (r next : Runtime) (i m : Nat)
    (idx : r.lookupLocal? "index"=some (.word i)) (acc : r.lookupLocal? "deployedMask"=some (.word m))
    (hi : i<256) (hm : m<R) (write : r.assignLocal? "deployedMask" (.word (m ||| 2^i))=some next) :
    setBit.value.eval (n+1) model.core.table c r=pure (.normal next) := by
  have pw : 2^i<R := Nat.pow_lt_pow_right (by decide) hi
  have bin := Inv08.ReleaseQuote.binary (Inv08.Authority.literal c r 1 (by decide)) (Inv08.localReads c r "index" i idx) .shl
    (by intro h;cases h) (by intro h;cases h) (oneShift c.checked i hi)
  have rhs : Inv40.Reads c r shift.value (2^i) := Inv08.ReleaseQuote.readClean (Inv08.Authority.castBits bin 256 (by decide) (by decide) pw) pw
  have result := Inv32Compound.expr 7 .bitOr c r next "deployedMask" m (2^i) _ shift.value acc (rhs 8 (by decide))
    (wordOr c.checked m _ hm pw) (Nat.or_lt_two_pow hm pw) write
  have full : Expr.eval c r (.assignment (some .bitOr) (some (.uint 256)) (.var "deployedMask") shift.value) = pure (.word (m ||| 2^i),next) := result
  change Stmt.eval _ _ _ _ (.exprStmt (.assignment (some .bitOr) (some (.uint 256)) (.var "deployedMask") shift.value))=_
  rw [Stmt.eval]; dsimp only;rw [full];rfl

theorem increment (n : Nat) (c : Context) (r next : Runtime) (i : Nat) (idx : r.lookupLocal? "index"=some (.word i))
    (hi : i<256) (write : r.assignLocal? "index" (.word (i+1))=some next) :
    step.value.eval (n+1) model.core.table c r=pure (.normal next) := by
  have noStorage : r.lookupStorageBase? "index"=none := by simp [Runtime.lookupStorageBase?,idx]
  have resolve : Expr.resolveLValueFuel 2 c r (.var "index")=pure (.local "index",r) := by rw [Expr.resolveLValueFuel,noStorage,idx]
  have read : (ResolvedLValue.local "index").read c r=.ok (.word i) := by
    simp [ResolvedLValue.read,ResolvedLValue.readRaw,idx,Runtime.derefMemoryValue,Bind.bind,Except.bind]
  have wr : (ResolvedLValue.local "index").write c r (.word (i+1))=.ok next := by simp [ResolvedLValue.write,write]
  have fit : i+1<R := lt_of_le_of_lt hi (by decide : 256<R)
  have add := Inv40.addWords c.checked i 1 fit
  have clean : (ValueCleanup.uint 256).apply c.checked (.word (i+1)) = .ok (.word (i+1)) := Inv32Guards.cleanupWord _ _ fit
  have act : (ResolvedLValue.local "index").applyIncDecCleanup c r .add false (.uint 256) = .ok (.word (i+1),next) := by
    simp [ResolvedLValue.applyIncDecCleanup,read,wr,Value.oneLike?,add,clean,Bind.bind,Except.bind]
  have eval : Expr.eval c r (.incDec .add false (some (.uint 256)) (.var "index"))=pure (.word (i+1),next) := by
    change Expr.evalFuel 3 c r _=_
    rw [Expr.evalFuel,resolve]
    simp only [Inv08.Authority.bindPure,act,Inv08.Authority.liftPure]
  change Stmt.eval _ _ _ _ (.exprStmt _) = _
  rw [Stmt.eval]; dsimp only; rw [eval];rfl
end Inv44
