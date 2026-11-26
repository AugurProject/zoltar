import Inv45DecimalRun
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Decimal
private def sig : List BindingDecl→List BindingDecl→Bool
  | [⟨"absoluteValue",.uint256,false⟩],[⟨"_ret0",.bytesCalldata,false⟩]=>true
  | _,_=>false
theorem signature : fn.params=[⟨number,.uint256,false⟩] ∧ fn.returns=[⟨"_ret0",.bytesCalldata,false⟩] := by
  have h : sig fn.params fn.returns := by native_decide
  generalize fn.params=ps at *;generalize fn.returns=rs at *
  unfold sig at h;split at h <;> simp_all
theorem prefixRun (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat) (V : v<R)
    (after : Runtime) (value : Value)
    (next : Stmt.evalList (n+1) t c (prepared r v).pushScope.pushScope (data.map Pattern.value)=pure (.returned after [value])) :
    Stmt.eval (n+3) t c (entry r v) body.value=pure (.returned after.popScope.popScope [value]) := by
  let s := entry r v
  have set := Inv32FloorFastPath.cleanParamExec (n+1) t c s.pushScope number v V rfl
    (by simp [s,entry,number,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have loc := localize (n+1) t c r v
  have inner := Inv32FloorFastPath.blockReturned (n+1) t c (prepared r v).pushScope after (data.map Pattern.value) [value] next
  apply Inv32FloorFastPath.blockReturned (n+2) t c s after.popScope _
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ set).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ loc).trans ?_
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ inner
theorem execution (fuel : Nat) (c : Context) (r : Runtime) (v : Nat) (V : v<R) (cap : c.memoryAllocationLimit?=none) :
    ∃ after out, Bytes.Retains r after ∧ Holds after (decimal v) out ∧
      Stmt.eval (fuel+84) model.core.table c (entry r v) fn.body=pure (.returned after [out]) := by
  rw [source]
  by_cases z : v=0
  · subst v
    let a := Bytes.allocate r []
    let src := (prepared r 0).pushScope.pushScope
    have test := MulDiv.eqZero (MulDiv.wordVar c src number 0 (by decide) rfl) (by decide)
    rw [if_pos rfl] at test
    have act : Stmt.eval (fuel+81) model.core.table c src (ret (bytesLiteral [48])).value=pure (.returned src [.bytes [48]]) := by
      change Stmt.eval _ _ _ _ (.returnValues [.byteArray [48]])=_
      rw [Stmt.eval];rfl
    have branch := Inv32Blocks.branch (fuel+81) model.core.table c src (MulDiv.equalZero (wvar number)).value (ret (bytesLiteral [48])).value
      .skip true (test _ (by decide))
    have ret := Inv32FloorFastPath.stop _ _ _ _ _ _ ((data.map Pattern.value).drop 1) _ (branch.trans act)
    refine ⟨src.popScope.popScope,.bytes [48],?_,?_,prefixRun (fuel+81) _ _ _ _ (by decide) _ _ ret⟩
    · exact ⟨rfl,(Bytes.allocated r []).next,(Bytes.allocated r []).memory⟩
    · exact Holds.direct
  · obtain ⟨m,keep,mem,execute⟩ := positiveData fuel c r v V (Nat.pos_of_ne_zero z) cap
    let a := Bytes.allocate r []
    let dst := withMemory (Bytes.allocate a (List.replicate (reversed v).length 0)) m
    let s := slots dst r.nextMemory a.nextMemory 0 0
    refine ⟨s.popScope.popScope,.memoryRef a.nextMemory,⟨keep.state,keep.next,keep.memory⟩,.ref (by exact Nat.lt_succ_self _) mem,?_⟩
    exact prefixRun (fuel+81) _ _ _ _ V _ _ execute
theorem call (fuel : Nat) (c : Context) (r : Runtime) (v : Nat) (name : String) (targets : List String)
    (V : v<R) (cap : c.memoryAllocationLimit?=none) (input : r.lookupLocal? name=some (.word v)) :
    ∃ after out, Bytes.Retains r after ∧ Holds after (decimal v) out ∧ after.locals=r.locals ∧
      Stmt.eval (fuel+85) model.core.table c r (.internalCall targets key [.var name])=internalCallAssign after targets [out] := by
  let empty := {r with locals:=[]}
  have found : model.core.table.lookup? key=some fn := (Option.some_get present).symm
  have args : Expr.evalRefArgList c r [.var name]=pure ([.word v],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var name]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ input,Inv08.Authority.bindPure]
  obtain ⟨ps,rs⟩ := signature
  have enter : internalCallEnter? fn [.word v] r=some (entry empty v,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,
      entry,empty,Runtime.withFrame]
  obtain ⟨done,value,keep,holds,ev⟩ := execution fuel {c with checked:=true} empty v V cap
  let after := {done with locals:=r.locals}
  refine ⟨after,value,⟨keep.state,keep.next,keep.memory⟩,?_,rfl,?_⟩
  · cases holds with
    | direct => exact .direct
    | ref b h => exact .ref b h
  · rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
    cases holds with
    | direct =>
      simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,
        Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,after]
    | ref b h => simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Bind.bind,Except.bind,after]
end Inv45.Decimal
