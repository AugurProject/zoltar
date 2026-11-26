import Inv45FormatterShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
theorem fetchMagnitudeLocal (n : Nat) (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v)
    (found : (r.declareLocal Add.temp (.word 0)).lookupLocal? "value"=some (.int (Signed.word v))) :
    Stmt.eval (n+9) model.core.table c (r.declareLocal Add.temp (.word 0)) hoist.value=pure (.normal (r.declareLocal Add.temp (.word v.natAbs))) := by
  let t := model.core.table
  let src := r.declareLocal Add.temp (.word 0)
  let init := src.pushScope.declareLocal "_ic_arg_0" (.int (Signed.word v))
  let args := tempArgs src v 0
  let fetched := tempArgs src v v.natAbs
  let copied := tempArgs (r.declareLocal Add.temp (.word v.natAbs)) v v.natAbs
  have E := intClean (readSignedLocal c src.pushScope "value" _ found) V
  have a := declareSigned (n+7) t "_ic_arg_0" (e:=Shapes.signedCast (varP "value")) E
  have b := Inv32FloorStart.zero (n+7) t c init magSlot
  have call := Shapes.absoluteCall n c args v "_ic_arg_0" [magSlot] V rfl
  have assigned : internalCallAssign args [magSlot] [.word v.natAbs]=pure (.normal fetched) := by
    dsimp [internalCallAssign,args,fetched,src];store_add
  have cap := Inv32Internal.capture (n+7) t c args fetched [magSlot] _ (call.trans assigned)
  have copy := Inv32Temps.copy (n+7) t c fetched copied temp magSlot 0 v.natAbs (by cases H : r.locals <;> simp [fetched,src,tempArgs,Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H,temp,magSlot]) rfl (by cases H : r.locals <;> simp [fetched,copied,src,tempArgs,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,H,temp,magSlot])
  let body := [Stmt_varDecl intTy (lit "_ic_arg_0") (Option_some (Shapes.signedCast (varP "value"))),
    decl magSlot Option_none, Stmt_captureReturn (seq [lit magSlot]) (Stmt_internalCall (seq [lit magSlot]) (lit Shapes.absoluteKey)
      (seq [varP "_ic_arg_0"])), assign temp (varP magSlot)]
  have list : Stmt.evalList (n+8) t c src.pushScope (body.map Pattern.value)=pure (.normal copied) := by
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ a).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ b).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans ?_;change Stmt.evalList (n+8) t c copied []=_;rw [Stmt.evalList]
  change Stmt.eval (n+9) t c src (.block (body.map Pattern.value))=_
  rw [Stmt.eval];dsimp only;rw [list];rfl
end Inv45.Add
namespace Inv45.Format
theorem declareSign (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v)
    (loc : r.lookupLocal? "value"=some (.int (Signed.word v))) :
    Stmt.eval (n+1) t c r declareNeg.value=pure (.normal (r.declareLocal "isNegative" (.word (if v<0 then 1 else 0)))) := by
  have Z : Signed.inRange 0 := by unfold Signed.inRange;decide
  have cmp : Source.BinaryOp.apply c.checked .lt (.int (Signed.word v)) (.int 0)=.ok (.word (if v<0 then 1 else 0)) := by
    change Except.ok (Value.word (Shared.sltWord (Signed.word v) (Signed.word 0)))=_
    rw [Signed.ltWord _ _ V Z]
  have rd := Inv45.binary .lt (intClean (readSignedLocal c r "value" _ loc) V) (readSignedLiteral c r 0 (by decide))
    (by intro h;cases h) (by intro h;cases h) cmp
  have E : Expr.eval c r neg.value=pure (.word (if v<0 then 1 else 0),r) := rd _ (by decide)
  change Stmt.eval _ _ _ _ (.varDecl .bool "isNegative" (some neg.value))=_
  rw [Stmt.eval];dsimp only;rw [E];by_cases h : v<0 <;> simp only [h,if_true,if_false] <;> rfl
theorem readBase (c : Context) (r : Runtime) (width : r.lookupLocal? "decimals"=some (.word 18)) :
    Inv40.Reads c r makeBase.value Text.base := by
  apply MulDiv.twiceReads _ (by decide)
  apply Inv08.ReleaseQuote.binary (Inv08.Authority.literal c r 10 (by decide)) (MulDiv.wordVar c r _ _ (by decide) width)
    .exp (by intro h;cases h) (by intro h;cases h)
  cases c.checked <;> rfl
theorem readParts (c : Context) (r : Runtime) (n : Nat) (word : n<R) (integer : Bool)
    (mag : r.lookupLocal? "absoluteValue"=some (.word n)) (base : r.lookupLocal? "base"=some (.word Text.base)) :
    Inv40.Reads c r (part integer).value (if integer then n/Text.base else n%Text.base) := by
  have A := MulDiv.wordVar c r _ _ word mag
  have B := MulDiv.wordVar c r _ _ (by decide : Text.base<R) base
  cases integer with
  | true => exact MulDiv.divRead A B word (by decide) (by decide)
  | false =>
    have F : n%Text.base<R := lt_trans (Nat.mod_lt _ (by decide)) (by decide)
    have raw : Shared.modWord n Text.base=n%Text.base := by
      unfold Shared.modWord Shared.liftEvmBinary
      rw [Signed.evm n word,Signed.evm Text.base (by decide)]
      change (n%Text.base)%R=n%Text.base;exact Nat.mod_eq_of_lt F
    apply MulDiv.twiceReads _ F
    apply Inv08.ReleaseQuote.binary A B .mod (by intro h;cases h) (by intro h;cases h)
    simp [Source.BinaryOp.apply,Source.BinaryOp.applyWord,Source.BinaryOp.preservesFixedBytesWidth,
      Value.forceAbiLazy,checkedMod,Bind.bind,Except.bind,raw,show Shared.norm Text.base=Text.base by decide]
end Inv45.Format
