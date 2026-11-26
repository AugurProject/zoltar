import Inv39MarkerSuffixSyntax
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker.ActualSuffix
open Inv45
set_option maxHeartbeats 4000000
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
theorem pureCaught {α : Type} (x : α) : (pure x : SolI α).caught=pure (.ok x) := rfl
def empty (r : Runtime) (name : String) := (Bytes.allocate r []).declareLocal name (.memoryRef r.nextMemory)
def callee (r : Runtime) := {r with locals:=[]}
def start (r : Runtime) (v : Nat) := empty ((empty r hoist).pushScope.declareLocal arg (.word v)) ret

theorem emptyRun (n : Nat) (c : Context) (r : Runtime) (name : String) :
    Stmt.eval (n+1) model.core.table c r (.memoryVarDecl .bytesCalldata name none)=pure (.normal (empty r name)) := by
  rw [Stmt.eval]
  simp [Runtime.declareMemoryLocal,Ty.defaultValue,Ty.coerceValue?,Runtime.memoryStoredValue,Runtime.allocMemory,empty,Bytes.allocate,Value.forceAbiLazy]

theorem capOkay (c : Context) (v : Nat) (V : v<R) (cap : c.memoryAllocationLimit?=none) :
    c.checkMemoryAllocation (Inv45.Decimal.reversed v).length=.ok (Inv45.Decimal.reversed v).length := by
  have bound : (Inv45.Decimal.reversed v).length≤78 := Inv45.Decimal.lengthBound v (lt_trans V (by decide : R<10^78))
  have small : (Inv45.Decimal.reversed v).length<R := lt_of_le_of_lt bound (by decide)
  simp [Context.checkMemoryAllocation,cap,show Shared.norm (Inv45.Decimal.reversed v).length=(Inv45.Decimal.reversed v).length from Nat.mod_eq_of_lt small,show ¬(Inv45.Decimal.reversed v).length>18446744073709551615 by omega]

/-- Exact generated decimal call, including its actual body run and finish. -/
theorem callRun (n : Nat) (c : Context) (r : Runtime) (v : Nat)
    (read : r.lookupLocal? arg=some (.word v)) (V : v<R)
    (cap : c.memoryAllocationLimit?=none) :
    ∃ after out, DecimalBound.Holds after (Inv45.Decimal.decimal v) out ∧
      after.state=r.state ∧
      Stmt.eval (n+85) model.core.table c r (.internalCall [ret] Decimal.key [.var arg])=
        internalCallFinish DecimalBound.fn [ret] r.locals (.returned after [out]) ∧
      Stmt.eval (n+84) model.core.table {c with checked:=true} (DecimalBound.entry (callee r) v) DecimalBound.fn.body=pure (.returned after [out]) := by
  obtain ⟨after,out,keep,holds,exec⟩ := DecimalBound.execution n model.core.table {c with checked:=true} (callee r) v V (capOkay _ v V cap)
  refine ⟨after,out,holds,keep.state,?_,exec⟩
  have args : Expr.evalRefArgList c r [.var arg]=pure ([.word v],r) := by
    change (do let (a,s) ← Expr.evalRefArg c r (.var arg); let (vs,s') ← Expr.evalRefArgListFuel _ c s []; pure (a::vs,s'))=_
    rw [Inv32ProductCall.wordArg _ _ _ _ read];rfl
  rw [Stmt.eval]; dsimp only; rw [args]
  simp only [pureCaught,Inv08.Authority.bindPure]
  simp only [DecimalBound.linked,DecimalBound.enter]
  change (Stmt.eval (n+84) model.core.table {c with checked:=true} (DecimalBound.entry (callee r) v) DecimalBound.fn.body >>= _) = _
  rw [exec]; rfl
end Inv39.Init.Marker.ActualSuffix
namespace Inv39.Init.Marker.ActualSuffix
open Inv45
set_option maxHeartbeats 4000000
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false

def closed (r : Runtime) (frames : LocalEnv) (id : Nat) :=
  {r with locals := [(hoist,.memoryRef id)] :: frames}

theorem finishRef (after : Runtime) (frames : LocalEnv) (a h id : Nat) :
    internalCallFinish DecimalBound.fn [ret]
      ([(ret,.memoryRef a),(arg,.word h)] :: [(hoist,.memoryRef (a-1))] :: frames)
      (.returned after [.memoryRef id]) =
    pure (.normal {after with locals := [(ret,.memoryRef id),(arg,.word h)] :: [(hoist,.memoryRef (a-1))] :: frames}) := by
  obtain ⟨f,found,_,rs,_⟩ := Decimal.linked
  have eq : f=DecimalBound.fn := Option.some.inj (found.symm.trans DecimalBound.linked)
  subst f
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,internalCallAssign,
    Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.lookupLocal?,
    Runtime.assignLocalRaw?,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,ret,arg,hoist,Bind.bind,Except.bind]

 theorem finishBytes (after : Runtime) (frames : LocalEnv) (a h : Nat) (bs : List Nat) :
    internalCallFinish DecimalBound.fn [ret]
      ([(ret,.memoryRef a),(arg,.word h)] :: [(hoist,.memoryRef (a-1))] :: frames)
      (.returned after [.bytes bs]) =
    pure (.normal {(Bytes.allocate after bs) with locals := [(ret,.memoryRef after.nextMemory),(arg,.word h)] :: [(hoist,.memoryRef (a-1))] :: frames}) := by
  obtain ⟨f,found,_,rs,_⟩ := Decimal.linked
  have eq : f=DecimalBound.fn := Option.some.inj (found.symm.trans DecimalBound.linked)
  subst f
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,internalCallAssign,
    Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.lookupLocal?,
    Runtime.assignLocalRaw?,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,ret,arg,hoist,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Value.forceAbiLazy,
    Runtime.memoryStoredValue,Runtime.allocMemory,Bytes.allocate,Value.isMemoryObject,Bind.bind,Except.bind]
theorem copyRun (n : Nat) (c : Context) (r : Runtime) (frames : LocalEnv) (a h id : Nat) :
    Stmt.eval (n+1) model.core.table c
      {r with locals := [(ret,.memoryRef id),(arg,.word h)] :: [(hoist,.memoryRef a)] :: frames}
      (.assign (.var hoist) (.var ret)) =
    pure (.normal {r with locals := [(ret,.memoryRef id),(arg,.word h)] :: [(hoist,.memoryRef id)] :: frames}) := by
  rw [Stmt.eval]
  simp [Runtime.lookupMemoryRef?,Runtime.lookupLocal?,Runtime.assignLocalRaw?,
    LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,ret,arg,hoist,Bind.bind,Except.bind]

theorem conversionRun (n : Nat) (c : Context) (r : Runtime) (frames : LocalEnv) (rep : Nat)
    (shape : r.locals=[]::frames)
    (read : r.lookupLocal? "repNumber_"=some (.word rep))
    (cap : c.memoryAllocationLimit?=none) :
    ∃ after out next id,
      Stmt.eval (n+84) model.core.table {c with checked:=true}
        (DecimalBound.entry (callee (start r (Shared.norm rep))) (Shared.norm rep)) DecimalBound.fn.body=pure (.returned after [out]) ∧
      after.derefMemoryValue out=.ok (.bytes (Inv45.Decimal.decimal (Shared.norm rep))) ∧
      after.state=r.state ∧ next.state=after.state ∧
      next.locals=[(hoist,.memoryRef id)]::frames ∧
      next.loadMemory? id=some (.bytes (Inv45.Decimal.decimal (Shared.norm rep))) ∧
      Stmt.eval (n+87) model.core.table c (empty r hoist) conversion=pure (.normal next) := by
  let v := Shared.norm rep
  let h := empty r hoist
  let a := h.pushScope.declareLocal arg (.word v)
  let pre := empty a ret
  have V : v<R := Nat.mod_lt _ (by decide)
  have repRead : h.pushScope.lookupLocal? "repNumber_"=some (.word rep) := by
    simpa [h,empty,Runtime.lookupLocal?,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,
      LocalEnv.lookup?,Frame.lookup?,hoist,Bytes.allocate,shape] using read
  have decl : Stmt.eval (n+86) model.core.table c h.pushScope
      (.varDecl .uint256 arg (some repValue))=pure (.normal a) := by
    rw [Stmt.eval];simp only [pureCaught,Inv08.Authority.bindPure];rw [show Expr.eval c h.pushScope repValue=pure (.word v,h.pushScope) from cleanupRead c h.pushScope rep 1 repRead]
    simp [pureCaught,Inv08.Authority.bindPure,Ty.coerceValue?,Value.forceAbiLazy,Shared.norm,Nat.mod_mod,a,v]
  have argRead : pre.lookupLocal? arg=some (.word v) := by
    simp [pre,a,h,empty,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,
      LocalEnv.lookup?,Frame.lookup?,ret,arg,Bytes.allocate,Runtime.pushScope]
  obtain ⟨after,out,holds,same,call,body⟩ := callRun n c pre v argRead V cap
  have preState : pre.state=r.state := rfl
  have locals : pre.locals=[(ret,.memoryRef (r.nextMemory+1)),(arg,.word v)] :: [(hoist,.memoryRef r.nextMemory)] :: frames := by
    simp [pre,a,h,empty,Runtime.declareLocal,LocalEnv.declare,Bytes.allocate,Runtime.pushScope,shape]
  have knownDecode : after.derefMemoryValue out=.ok (.bytes (Inv45.Decimal.decimal v)) := by
    cases holds with
    | direct => rfl
    | ref bound cell => simp [Runtime.derefMemoryValue,cell]
  obtain ⟨actual,bs,outputs,actualDecode,_,_⟩ := DecimalBound.successfulOutput (n+84) {c with checked:=true} (callee pre) after v V [out] body
  have actualEq : actual=out := by simpa using outputs.symm
  subst actual
  have bsEq : bs=Inv45.Decimal.decimal v := by
    rw [knownDecode] at actualDecode
    exact (Value.bytes.inj (Except.ok.inj actualDecode)).symm
  have decode : after.derefMemoryValue out=.ok (.bytes (Inv45.Decimal.decimal v)) := bsEq ▸ actualDecode
  cases holds with
  | direct =>
    let allocated := Bytes.allocate after (Inv45.Decimal.decimal v)
    let done := closed allocated frames after.nextMemory
    refine ⟨after,.bytes (Inv45.Decimal.decimal v),done,after.nextMemory,body,decode,same.trans preState,rfl,rfl,?_,?_⟩
    · change (after.memory.insert after.nextMemory (.bytes (Inv45.Decimal.decimal v)))[after.nextMemory]?=_
      simp [v]
    · rw [conversion,Stmt.eval]
      change (Stmt.evalList (n+86) model.core.table c h.pushScope _ >>= _) = _
      rw [Stmt.evalList,decl];simp only [pureCaught,Inv08.Authority.bindPure]
      rw [Stmt.evalList,emptyRun];simp only [pureCaught,Inv08.Authority.bindPure]
      have fin := finishBytes after frames (r.nextMemory+1) v (Inv45.Decimal.decimal v)
      simp only [Nat.add_sub_cancel] at fin
      have cr : Stmt.eval (n+86) model.core.table c pre (.captureReturn [ret] (.internalCall [ret] Decimal.key [.var arg]))=
          pure (.normal {allocated with locals := [(ret,.memoryRef after.nextMemory),(arg,.word v)] :: [(hoist,.memoryRef r.nextMemory)] :: frames}) := by
        rw [Stmt.eval];dsimp only
        rw [call,locals,fin]
        simp only [Inv08.Authority.bindPure]
        rfl
      rw [Stmt.evalList,cr];simp only [pureCaught,Inv08.Authority.bindPure]
      rw [Stmt.evalList,copyRun]
      simp only [Inv08.Authority.bindPure,Stmt.evalList]
      rfl
  | ref bound cell =>
    rename_i id
    let done := closed after frames id
    refine ⟨after,.memoryRef id,done,id,body,decode,same.trans preState,rfl,rfl,cell,?_⟩
    rw [conversion,Stmt.eval]
    change (Stmt.evalList (n+86) model.core.table c h.pushScope _ >>= _) = _
    rw [Stmt.evalList,decl];simp only [pureCaught,Inv08.Authority.bindPure]
    rw [Stmt.evalList,emptyRun];simp only [pureCaught,Inv08.Authority.bindPure]
    have fin := finishRef after frames (r.nextMemory+1) v id
    simp only [Nat.add_sub_cancel] at fin
    have cr : Stmt.eval (n+86) model.core.table c pre (.captureReturn [ret] (.internalCall [ret] Decimal.key [.var arg]))=
        pure (.normal {after with locals := [(ret,.memoryRef id),(arg,.word v)] :: [(hoist,.memoryRef r.nextMemory)] :: frames}) := by
      rw [Stmt.eval];dsimp only
      rw [call,locals,fin]
      simp only [Inv08.Authority.bindPure]
    rw [Stmt.evalList,cr];simp only [pureCaught,Inv08.Authority.bindPure]
    rw [Stmt.evalList,copyRun]
    simp only [Inv08.Authority.bindPure,Stmt.evalList]
    rfl

end Inv39.Init.Marker.ActualSuffix
