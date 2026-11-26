import Inv45MemoryCalls
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Format
open Bytes
theorem fetchPadded (fuel : Nat) (c : Context) (r : Runtime) (old src : Nat) (xs : List Nat)
    (input : Ref (r.declareLocal temp1 (.memoryRef old)) temp0 src xs)
    (width : (r.declareLocal temp1 (.memoryRef old)).lookupLocal? "decimals"=some (.word 18))
    (small : xs.length≤18) (sane : ∀v∈xs,v<256) (sourceBound : src<r.nextMemory) (cap : c.memoryAllocationLimit?=none) :
    ∃a id, Retains r a ∧ id<a.nextMemory ∧ a.loadMemory? id=some (.bytes (Text.pad xs)) ∧
      Stmt.eval (fuel+31) model.core.table c (r.declareLocal temp1 (.memoryRef old)) padHoist.value=
        pure (.normal ((localsOf a r).declareLocal temp1 (.memoryRef id))) := by
  let t := model.core.table
  let s := r.declareLocal temp1 (.memoryRef old)
  let stage := s.pushScope.declareLocal "_ic_arg_0" (.memoryRef src)
  let args := stage.declareLocal "_ic_arg_1" (.word 18)
  let fresh := allocate args []
  let init := fresh.declareLocal padSlot (.memoryRef args.nextMemory)
  have arg := aliasExec (fuel+29) t c s.pushScope "_ic_arg_0" temp0 src input.pointer
  have widthRead : stage.lookupLocal? "decimals"=some (.word 18) := width
  have count := Add.declareWord (fuel+29) t "_ic_arg_1" (MulDiv.wordVar c stage "decimals" 18 (by decide) widthRead)
  have tmp := Bytes.blank (fuel+29) t c args padSlot
  have keep := allocated args []
  have source : Ref init "_ic_arg_0" src xs := ⟨rfl,(keep.memory src sourceBound).trans input.cell⟩
  obtain ⟨returned,val,kept,ok,stored,localEq,call⟩ := Pad.call (fuel+1) c init "_ic_arg_0" "_ic_arg_1" xs src [padSlot] small sane
    (lt_of_lt_of_le sourceBound keep.next) source rfl cap
  have holds : Decimal.Holds returned (Text.pad xs) (.memoryRef val) := .ref ok stored
  obtain ⟨a,id,stay,bound,cell,assignRes⟩ := captureTop returned args padSlot args.nextMemory _ (.memoryRef val) localEq holds
  let mid := (localsOf a args).declareLocal padSlot (.memoryRef id)
  let dst := (localsOf a r).declareLocal temp1 (.memoryRef id)
  let done := (dst.withFrame [ (padSlot,.memoryRef id),("_ic_arg_1",.word 18),("_ic_arg_0",.memoryRef src)])
  have callExec := Inv32Internal.capture (fuel+29) t c init mid [padSlot] _ (call.trans assignRes)
  have raw : mid.assignLocalRaw? temp1 (.memoryRef id)=some done := by
    cases H : r.locals <;> simp [mid,done,dst,args,stage,s,localsOf,Runtime.assignLocalRaw?,Runtime.withFrame,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,H,padSlot,temp1]
  have target : mid.lookupLocal? temp1=some (.memoryRef old) := by
    cases H : r.locals <;> simp [mid,args,stage,s,localsOf,Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H,padSlot,temp1]
  have copy := copyRef (fuel+29) t c mid done temp1 padSlot old id target (declarePtr _ _ _) raw
  let body := [aliasBytes "_ic_arg_0" temp0,Add.fromVar "_ic_arg_1" (wvar "decimals"),blank padSlot,
    callBytes padSlot Pad.key ["_ic_arg_0","_ic_arg_1"],Inv03.Bodies.assign temp1 (varP padSlot)]
  have run : Stmt.evalList (fuel+30) t c s.pushScope (body.map Pattern.value)=pure (.normal done) := by
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ count).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ tmp).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ callExec).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans
    change Stmt.evalList (fuel+30) _ _ _ []=_;rw [Stmt.evalList]
  have freshKeep : Retains r init := ⟨rfl,Nat.le_succ _,(allocated args []).memory⟩
  refine ⟨a,id,trans freshKeep (trans kept stay),bound,cell,?_⟩
  change Stmt.eval (fuel+31) t c s (.block (body.map Pattern.value))=_
  rw [Stmt.eval];dsimp only;rw [run];rfl
end Inv45.Format
