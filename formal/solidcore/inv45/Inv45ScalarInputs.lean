import Inv45ScalarShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
theorem greater (c : Context) (r : Runtime) (lo hi : Int) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (l : r.lookupLocal? "minValue"=some (.int (Signed.word lo))) (h : r.lookupLocal? "maxValue"=some (.int (Signed.word hi))) :
    Inv40.Reads c r (Expr_binary BinaryOp_gt (sVar "maxValue") (sVar "minValue")).value 1 := by
  apply Inv45.binary .gt (intClean (readSignedLocal c r _ _ h) H) (intClean (readSignedLocal c r _ _ l) L)
    (by intro h;cases h) (by intro h;cases h)
  have eq (a b : EvmYul.UInt256) : EvmYul.UInt256.sgtBool a b=EvmYul.UInt256.sltBool b a := by
    unfold EvmYul.UInt256.sgtBool EvmYul.UInt256.sltBool;split_ifs <;> rfl
  have reverse : Shared.sgtWord (Signed.word hi) (Signed.word lo)=Shared.sltWord (Signed.word lo) (Signed.word hi) := by
    unfold Shared.sgtWord Shared.sltWord Shared.liftEvmBinary EvmYul.UInt256.sgt EvmYul.UInt256.slt;rw [eq]
  change Except.ok (Value.word (Shared.sgtWord (Signed.word hi) (Signed.word lo)))=_
  rw [reverse,Signed.ltWord lo hi L H,if_pos rise]
theorem payoutDecl (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (id other k : Nat)
    (pointer : r.lookupLocal? "payoutNumerators"=some (.memoryRef id))
    (cell : r.loadMemory? id=some (.fixedArray [.word other,.word k])) (K : k<R) :
    Stmt.eval (fuel+1) t c r (Add.fromVar "payout" payout).value=pure (.normal (r.declareLocal "payout" (.word k))) := by
  have ns : r.lookupStorageBase? "payoutNumerators"=none := by simp [Runtime.lookupStorageBase?,pointer]
  have arr : Expr.evalFuel 2 c r (.var "payoutNumerators")=pure (.fixedArray [.word other,.word k],r) := by
    rw [Expr.evalFuel,ns,pointer];simp [Runtime.derefMemoryValue,cell,Inv08.Authority.liftPure,Inv08.Authority.bindPure]
  have args : Expr.evalListFuel 3 c r [.var "payoutNumerators",.word 1]=pure ([.fixedArray [.word other,.word k],.word 1],r) := by
    rw [Expr.evalListFuel,arr];rfl
  have ix : Expr.evalFuel 4 c r (.index (.var "payoutNumerators") (.word 1))=pure (.word k,r) := by
    rw [Expr.evalFuel];simp only [Expr.hasStorageRoot,Expr.hasStorageRefRoot,ns,Option.isSome_none,Bool.false_eq_true,if_false,args,Inv08.Authority.bindPure]
    rfl
  have cast : uintCast? 256 (.word k)=.ok (.word k) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,show Shared.norm k=k from Nat.mod_eq_of_lt K,Nat.mod_eq_of_lt K,Bind.bind,Except.bind];exact K
  have clean := Inv32Guards.cleanupWord c.checked k K
  have E : Expr.eval c r payout.value=pure (.word k,r) := by
    change Expr.evalFuel 6 c r (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.index (.var "payoutNumerators") (.word 1))))=_
    rw [Expr.evalFuel,Expr.evalFuel,ix];simp only [Inv08.Authority.bindPure,Inv08.Authority.liftPure,cast,clean]
  change Stmt.eval _ _ _ _ (.varDecl .uint256 "payout" (some payout.value))=_
  rw [Stmt.eval];dsimp only;rw [E];rfl
theorem deltaRead (c : Context) (r : Runtime) (lo hi : Int) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (l : r.lookupLocal? "minValue"=some (.int (Signed.word lo))) (h : r.lookupLocal? "maxValue"=some (.int (Signed.word hi))) :
    Inv40.Reads {c with checked:=false} r rawDiff.value (hi-lo).toNat := by
  let ctx := {c with checked:=false}
  have unsigned (name : String) (v : Int) (V : Signed.inRange v) (loc : r.lookupLocal? name=some (.int (Signed.word v))) :
      Inv40.Reads ctx r (uVar name).value (Signed.word v) :=
    Inv08.ReleaseQuote.readClean (uintFromInt (readSignedLocal _ _ _ _ loc) (Signed.wordFit _ V) false) (Signed.wordFit _ V)
  have X := MulDiv.diffRead (unsigned _ _ H h) (unsigned _ _ L l) (Signed.wordFit _ H) (Signed.wordFit _ L) rfl
  rwa [(Scale.distance lo hi L H rise).2.2] at X
end Inv45.Scalar
