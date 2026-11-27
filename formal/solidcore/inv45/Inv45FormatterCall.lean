import Inv45FormatterRun
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Format
open Bytes
theorem execution (fuel : Nat) (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v) (cap : c.memoryAllocationLimit?=none) :
    ∃after out, Retains r after ∧ Decimal.Holds after (Text.signed v) out ∧
      Stmt.eval (fuel+94) model.core.table c (entry r v (.bytes [])) fn.body=pure (.returned after [out]) := by
  let t := model.core.table
  let s := entry r v (.bytes [])
  let a := allocate r []
  let prepared := entry a v (.memoryRef r.nextMemory)
  have norm : Shared.norm (Signed.word v)=Signed.word v := Nat.mod_eq_of_lt (Signed.wordFit _ V)
  have cleanV := Shapes.assignInput (fuel+92) t c s.pushScope v V rfl
    (by simp [s,entry,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,norm])
  have cleanD := Inv32FloorFastPath.cleanParamExec (fuel+92) t c s.pushScope "decimals" 18 (by decide) rfl
    (by simp [s,entry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have loc : Stmt.eval (fuel+93) t c s.pushScope Decimal.initRet.value=pure (.normal prepared.pushScope) := by
    change Stmt.eval _ _ _ _ (.memoryLocalize .bytesCalldata "_ret0")=_
    rw [Stmt.eval];rfl
  obtain ⟨after,out,keep,holds,run⟩ := runData fuel c a v r.nextMemory V cap
  have inner := Inv32FloorFastPath.blockReturned (fuel+92) t c prepared.pushScope after _ [out] run
  have stable := Bytes.trans (allocated r []) keep
  refine ⟨after.popScope.popScope,out,⟨stable.state,stable.next,stable.memory⟩,?_,?_⟩
  · cases holds with | direct=>exact .direct | ref b h=>exact .ref b h
  · rw [source];apply Inv32FloorFastPath.blockReturned (fuel+93) t c s after.popScope _
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cleanV).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cleanD).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ loc).trans
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ inner
theorem call (fuel : Nat) (c : Context) (r : Runtime) (v : Int) (valueArg digits : String) (targets : List String)
    (V : Signed.inRange v) (vHere : r.lookupLocal? valueArg=some (.int (Signed.word v)))
    (dHere : r.lookupLocal? digits=some (.word 18)) (cap : c.memoryAllocationLimit?=none) :
    ∃after out, Retains r after ∧ Decimal.Holds after (Text.signed v) out ∧ after.locals=r.locals ∧
      Stmt.eval (fuel+95) model.core.table c r (.internalCall targets key [.var valueArg,.var digits])=internalCallAssign after targets [out] := by
  let empty := {r with locals:=[]}
  have found : model.core.table.lookup? key=some fn := (Option.some_get present).symm
  have refArg : Expr.evalRefArg c r (.var valueArg)=pure (.int (Signed.word v),r) := by
    simp only [Expr.evalRefArg,Runtime.lookupMemoryRef?,Runtime.lookupStorageBase?,vHere]
    exact readSignedLocal _ _ _ _ vHere _ (Nat.le_succ _)
  have args : Expr.evalRefArgList c r [.var valueArg,.var digits]=pure ([.int (Signed.word v),.word 18],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var valueArg,.var digits]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,refArg,
      Inv32ProductCall.wordArg _ _ _ _ dHere,Inv08.Authority.bindPure]
  obtain ⟨ps,rs⟩ := signature
  have enter : internalCallEnter? fn [.int (Signed.word v),.word 18] r=some (entry empty v (.bytes []),r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs];simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
      Ty.coerceValue?,Ty.defaultValue,entry,empty,Runtime.withFrame]
  obtain ⟨done,out,keep,holds,ev⟩ := execution fuel {c with checked:=true} empty v V cap
  let after := {done with locals:=r.locals}
  refine ⟨after,out,⟨keep.state,keep.next,keep.memory⟩,?_,rfl,?_⟩
  · cases holds with | direct=>exact .direct | ref b h=>exact .ref b h
  · rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
    cases holds with
    | direct => simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,
        Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,after]
    | ref b h => simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Bind.bind,Except.bind,after]
end Inv45.Format
