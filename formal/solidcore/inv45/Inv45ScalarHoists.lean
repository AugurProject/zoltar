import Inv45ScalarShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Format
open Bytes
theorem fetchNumTicks (fuel : Nat) (c : Context) (r : Runtime) (old v : Nat)
    (found : (r.declareLocal temp1 (.memoryRef old)).lookupLocal? "numTicks"=some (.word v))
    (word : v<R) (cap : c.memoryAllocationLimit?=none) :
    ∃a id, Retains r a ∧ id<a.nextMemory ∧ a.loadMemory? id=some (.bytes (Decimal.decimal v)) ∧
      Stmt.eval (fuel+88) model.core.table c (r.declareLocal temp1 (.memoryRef old)) Scalar.tickOf.value=
        pure (.normal ((localsOf a r).declareLocal temp1 (.memoryRef id))) := by
  let t := model.core.table
  let s := r.declareLocal temp1 (.memoryRef old)
  let args := s.pushScope.declareLocal "_ic_arg_0" (.word v)
  let fresh := allocate args []
  let init := fresh.declareLocal decimalSlot (.memoryRef args.nextMemory)
  have arg := Add.declareWord (fuel+86) t "_ic_arg_0" (MulDiv.wordVar c s.pushScope "numTicks" v word found)
  have tmp := Bytes.blank (fuel+86) t c args decimalSlot
  obtain ⟨returned,val,kept,holds,localEq,call⟩ := Decimal.call (fuel+1) c init v "_ic_arg_0" [decimalSlot] word cap rfl
  obtain ⟨a,id,stay,bound,cell,assignRes⟩ := captureTop returned args decimalSlot args.nextMemory _ val localEq holds
  let mid := (localsOf a args).declareLocal decimalSlot (.memoryRef id)
  let dst := (localsOf a r).declareLocal temp1 (.memoryRef id)
  let done := (dst.withFrame [ (decimalSlot,.memoryRef id),("_ic_arg_0",.word v)])
  have callExec := Inv32Internal.capture (fuel+86) t c init mid [decimalSlot] _ (call.trans assignRes)
  have raw : mid.assignLocalRaw? temp1 (.memoryRef id)=some done := by
    cases H : r.locals <;> simp [mid,done,dst,args,s,localsOf,Runtime.assignLocalRaw?,Runtime.withFrame,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,H,decimalSlot,temp1]
  have target : mid.lookupLocal? temp1=some (.memoryRef old) := by
    cases H : r.locals <;> simp [mid,args,s,localsOf,Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H,decimalSlot,temp1]
  have copy := copyRef (fuel+86) t c mid done temp1 decimalSlot old id target (declarePtr _ _ _) raw
  let body := [Add.fromVar "_ic_arg_0" (wvar "numTicks"),blank decimalSlot,callBytes decimalSlot Decimal.key ["_ic_arg_0"],Inv03.Bodies.assign temp1 (varP decimalSlot)]
  have run : Stmt.evalList (fuel+87) t c s.pushScope (body.map Pattern.value)=pure (.normal done) := by
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ tmp).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ callExec).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans
    change Stmt.evalList (fuel+87) _ _ _ []=_;rw [Stmt.evalList]
  have freshKeep : Retains r init := ⟨rfl,Nat.le_succ _,(allocated args []).memory⟩
  refine ⟨a,id,trans freshKeep (trans kept stay),bound,cell,?_⟩
  change Stmt.eval (fuel+88) t c s (.block (body.map Pattern.value))=_
  rw [Stmt.eval];dsimp only;rw [run];rfl
theorem fetchFormatted (fuel : Nat) (c : Context) (r : Runtime) (old : Nat) (v : Int)
    (input : (r.declareLocal temp0 (.memoryRef old)).lookupLocal? "scalarValue"=some (.int (Signed.word v))) (V : Signed.inRange v) (cap : c.memoryAllocationLimit?=none) :
    ∃a id, Retains r a ∧ id<a.nextMemory ∧ a.loadMemory? id=some (.bytes (Text.signed v)) ∧
      Stmt.eval (fuel+98) model.core.table c (r.declareLocal temp0 (.memoryRef old)) Scalar.formatValue.value=
        pure (.normal ((localsOf a r).declareLocal temp0 (.memoryRef id))) := by
  let t := model.core.table
  let s := r.declareLocal temp0 (.memoryRef old)
  let stage := s.pushScope.declareLocal "_ic_arg_0" (.int (Signed.word v))
  let args := stage.declareLocal "_ic_arg_1" (.word 18)
  let fresh := allocate args []
  let init := fresh.declareLocal Scalar.formatSlot (.memoryRef args.nextMemory)
  have arg := Add.declareSigned (fuel+96) t "_ic_arg_0" (e:=Scalar.sVar "scalarValue") (intClean (readSignedLocal c s.pushScope _ _ input) V)
  have prec : Inv40.Reads c stage Scalar.precision.value 18 := by
    intro f h;change 4≤f at h;obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le h;rw [Nat.add_comm]
    change Expr.evalFuel (n+4) c stage (.ternary (.word 1) (.word 18) (.word 18))=_
    rw [Expr.evalFuel];rfl
  have count := Add.declareWord (fuel+96) t "_ic_arg_1" prec
  have tmp := Bytes.blank (fuel+96) t c args Scalar.formatSlot
  obtain ⟨returned,val,kept,holds,localEq,call⟩ := Format.call (fuel+1) c init v "_ic_arg_0" "_ic_arg_1" [Scalar.formatSlot] V rfl rfl cap
  obtain ⟨a,id,stay,bound,cell,assignRes⟩ := captureTop returned args Scalar.formatSlot args.nextMemory _ val localEq holds
  let mid := (localsOf a args).declareLocal Scalar.formatSlot (.memoryRef id)
  let dst := (localsOf a r).declareLocal temp0 (.memoryRef id)
  let done := (dst.withFrame [ (Scalar.formatSlot,.memoryRef id),("_ic_arg_1",.word 18),("_ic_arg_0",.int (Signed.word v))])
  have callExec := Inv32Internal.capture (fuel+96) t c init mid [Scalar.formatSlot] _ (call.trans assignRes)
  have raw : mid.assignLocalRaw? temp0 (.memoryRef id)=some done := by
    cases H : r.locals <;> simp [mid,done,dst,args,stage,s,localsOf,Runtime.assignLocalRaw?,Runtime.withFrame,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,H,Scalar.formatSlot,temp0]
  have target : mid.lookupLocal? temp0=some (.memoryRef old) := by
    cases H : r.locals <;> simp [mid,args,stage,s,localsOf,Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H,Scalar.formatSlot,temp0]
  have copy := copyRef (fuel+96) t c mid done temp0 Scalar.formatSlot old id target (declarePtr _ _ _) raw
  let body := [Scalar.sint "_ic_arg_0" (Option_some (Scalar.sVar "scalarValue")),Add.fromVar "_ic_arg_1" Scalar.precision,
    Format.blank Scalar.formatSlot,Format.callBytes Scalar.formatSlot Format.key ["_ic_arg_0","_ic_arg_1"],Inv03.Bodies.assign Format.temp0 (varP Scalar.formatSlot)]
  have run : Stmt.evalList (fuel+97) t c s.pushScope (body.map Pattern.value)=pure (.normal done) := by
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ count).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ tmp).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ callExec).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans
    change Stmt.evalList (fuel+97) _ _ _ []=_;rw [Stmt.evalList]
  have freshKeep : Retains r init := ⟨rfl,Nat.le_succ _,(allocated args []).memory⟩
  refine ⟨a,id,trans freshKeep (trans kept stay),bound,cell,?_⟩
  change Stmt.eval (fuel+98) t c s (.block (body.map Pattern.value))=_
  rw [Stmt.eval];dsimp only;rw [run];rfl
end Inv45.Format
