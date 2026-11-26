import Inv45MemoryCalls
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Format
open Bytes
theorem fetchDecimal (fuel : Nat) (c : Context) (r : Runtime) (name : String) (old v : Nat)
    (found : (r.declareLocal temp0 (.memoryRef old)).lookupLocal? name=some (.word v))
    (word : v<R) (cap : c.memoryAllocationLimit?=none) :
    ∃a id, Retains r a ∧ id<a.nextMemory ∧ a.loadMemory? id=some (.bytes (Decimal.decimal v)) ∧
      Stmt.eval (fuel+88) model.core.table c (r.declareLocal temp0 (.memoryRef old)) (decimalHoist name).value=
        pure (.normal ((localsOf a r).declareLocal temp0 (.memoryRef id))) := by
  let t := model.core.table
  let s := r.declareLocal temp0 (.memoryRef old)
  let args := s.pushScope.declareLocal "_ic_arg_0" (.word v)
  let fresh := allocate args []
  let init := fresh.declareLocal decimalSlot (.memoryRef args.nextMemory)
  have arg := Add.declareWord (fuel+86) t "_ic_arg_0" (MulDiv.wordVar c s.pushScope name v word found)
  have tmp := Bytes.blank (fuel+86) t c args decimalSlot
  obtain ⟨returned,val,kept,holds,localEq,call⟩ := Decimal.call (fuel+1) c init v "_ic_arg_0" [decimalSlot] word cap rfl
  obtain ⟨a,id,stay,bound,cell,assignRes⟩ := captureTop returned args decimalSlot args.nextMemory _ val localEq holds
  let mid := (localsOf a args).declareLocal decimalSlot (.memoryRef id)
  let dst := (localsOf a r).declareLocal temp0 (.memoryRef id)
  let done := (dst.withFrame [ (decimalSlot,.memoryRef id),("_ic_arg_0",.word v)])
  have callExec := Inv32Internal.capture (fuel+86) t c init mid [decimalSlot] _ (call.trans assignRes)
  have raw : mid.assignLocalRaw? temp0 (.memoryRef id)=some done := by
    cases H : r.locals <;> simp [mid,done,dst,args,s,localsOf,Runtime.assignLocalRaw?,Runtime.withFrame,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,H,decimalSlot,temp0]
  have target : mid.lookupLocal? temp0=some (.memoryRef old) := by
    cases H : r.locals <;> simp [mid,args,s,localsOf,Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H,decimalSlot,temp0]
  have copy := copyRef (fuel+86) t c mid done temp0 decimalSlot old id target (declarePtr _ _ _) raw
  let body := [Add.fromVar "_ic_arg_0" (wvar name),blank decimalSlot,callBytes decimalSlot Decimal.key ["_ic_arg_0"],Inv03.Bodies.assign temp0 (varP decimalSlot)]
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
end Inv45.Format
