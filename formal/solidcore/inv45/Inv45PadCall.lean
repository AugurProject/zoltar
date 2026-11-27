import Inv45PadActions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Pad
open Bytes
def entry (r : Runtime) (v : Value) := r.withFrame [("value",v),("totalLength",.word 18),("_ret0",.bytes [])]
private def sig : List BindingDecl→List BindingDecl→Bool
  | [⟨"value",.bytesCalldata,false⟩,⟨"totalLength",.uint256,false⟩],[⟨"_ret0",.bytesCalldata,false⟩]=>true
  | _,_=>false
theorem signature : fn.params=[⟨"value",.bytesCalldata,false⟩,⟨"totalLength",.uint256,false⟩] ∧ fn.returns=[⟨"_ret0",.bytesCalldata,false⟩] := by
  have h : sig fn.params fn.returns := by native_decide
  generalize fn.params=ps at *;generalize fn.returns=rs at *
  unfold sig at h;split at h <;> simp_all
theorem execution (fuel : Nat) (c : Context) (r : Runtime) (xs : List Nat) (v : Value)
    (small : xs.length≤18) (sane : ∀v∈xs,v<256) (input : Decimal.Holds r xs v) (cap : c.memoryAllocationLimit?=none) :
    ∃after id, Retains r after ∧ id<after.nextMemory ∧ after.loadMemory? id=some (.bytes (Text.pad xs)) ∧
      Stmt.eval (fuel+27) model.core.table c (entry r v) fn.body=pure (.returned after [.memoryRef id]) := by
  let t := model.core.table
  have beginValue : ∃s src, Retains r s ∧ src<s.nextMemory ∧ s.loadMemory? src=some (.bytes xs) ∧
      Stmt.eval (fuel+26) t c (entry r v).pushScope (localize "value").value=
        pure (.normal (entry s (.memoryRef src)).pushScope) := by
    cases input with
    | direct =>
      refine ⟨allocate r xs,r.nextMemory,allocated r xs,Nat.lt_succ_self _,load r _ _,?_⟩
      change Stmt.eval _ _ _ _ (.memoryLocalize .bytesCalldata "value")=_
      rw [Stmt.eval];rfl
    | @ref id bound cell =>
      refine ⟨r,id,unchanged r,bound,cell,?_⟩
      change Stmt.eval _ _ _ _ (.memoryLocalize .bytesCalldata "value")=_
      rw [Stmt.eval];rfl
  obtain ⟨s,src,keep,bound,cell,loc⟩ := beginValue
  let e := entry s (.memoryRef src)
  let a := allocate s []
  have set := Inv32FloorFastPath.cleanParamExec (fuel+25) t c e.pushScope "totalLength" 18 (by decide) rfl
    (by simp [e,entry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,LocalEnv.assign?,
      LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have retLocal : Stmt.eval (fuel+26) t c e.pushScope Decimal.initRet.value=pure (.normal (frame a src s.nextMemory).pushScope) := by
    change Stmt.eval _ _ _ _ (.memoryLocalize .bytesCalldata "_ret0")=_
    rw [Stmt.eval];rfl
  have alloc := allocated s []
  obtain ⟨after,id,preserve,idBound,bytes,run⟩ := runData fuel c a src s.nextMemory xs small sane
    (lt_of_lt_of_le bound alloc.next) ((alloc.memory _ bound).trans cell) cap
  have bodyExec := Inv32FloorFastPath.blockReturned (fuel+25) t c (frame a src s.nextMemory).pushScope after _ [.memoryRef id] run
  have allKeep := trans keep (trans alloc preserve)
  refine ⟨after.popScope.popScope,id,⟨allKeep.state,allKeep.next,allKeep.memory⟩,idBound,bytes,?_⟩
  rw [source];apply Inv32FloorFastPath.blockReturned (fuel+26) t c (entry r v) after.popScope _
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ loc).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ set).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ retLocal).trans
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ bodyExec
theorem call (fuel : Nat) (c : Context) (r : Runtime) (src count : String) (xs : List Nat) (id : Nat) (targets : List String)
    (small : xs.length≤18) (sane : ∀v∈xs,v<256) (bound : id<r.nextMemory) (input : Ref r src id xs)
    (width : r.lookupLocal? count=some (.word 18)) (cap : c.memoryAllocationLimit?=none) :
    ∃after out, Retains r after ∧ out<after.nextMemory ∧ after.loadMemory? out=some (.bytes (Text.pad xs)) ∧ after.locals=r.locals ∧
      Stmt.eval (fuel+28) model.core.table c r (.internalCall targets key [.var src,.var count])=internalCallAssign after targets [.memoryRef out] := by
  let empty := {r with locals:=[]}
  have found : model.core.table.lookup? key=some fn := (Option.some_get present).symm
  have arg : Expr.evalRefArg c r (.var src)=pure (.memoryRef id,r) := by
    simp [Expr.evalRefArg,Runtime.lookupStorageBase?,Runtime.lookupMemoryRef?,input.pointer]
  have args : Expr.evalRefArgList c r [.var src,.var count]=pure ([.memoryRef id,.word 18],r) := by
    change Expr.evalRefArgListFuel (_+1+1+1) c r [.var src,.var count]=_
    simp only [Expr.evalRefArgListFuel,arg,Inv32ProductCall.wordArg _ _ _ _ width,Inv08.Authority.bindPure]
  obtain ⟨ps,rs⟩ := signature
  have enter : internalCallEnter? fn [.memoryRef id,.word 18] r=some (entry empty (.memoryRef id),r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs];simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,entry,empty,Runtime.withFrame]
  obtain ⟨done,out,keep,ok,mem,ev⟩ := execution fuel {c with checked:=true} empty xs (.memoryRef id) small sane (.ref bound input.cell) cap
  let after := {done with locals:=r.locals}
  refine ⟨after,out,⟨keep.state,keep.next,keep.memory⟩,ok,mem,rfl,?_⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Bind.bind,Except.bind,after]
end Inv45.Pad
