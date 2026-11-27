import Inv45Invariant
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Public
set_option linter.unusedSimpArgs false
set_option maxHeartbeats 4000000
abbrev reservedKey := "__internal_hasNonZeroScalarReservedBits(uint256)#[SolidCore.Solidity.Ty.uint 256]"
def reservedFn? := model.core.table.lookup? reservedKey
theorem reservedPresent : reservedFn?.isSome := by native_decide
def reservedFn := reservedFn?.get reservedPresent
def band := Expr_binary BinaryOp_bitAnd
def sub := Expr_binary BinaryOp_sub
def shl := Expr_binary (⟨.shl,(fun | .shl=>true | _=>false),by intro v h;cases v <;> simp_all⟩)
def twice := MulDiv.twice
def mask := twice (Add.uintConvert (shl (twice (sub (num 32768) (num 1))) (num 240)))
def reservedExpr := Expr_binary (⟨.ne,(fun | .ne=>true | _=>false),by intro v h;cases v <;> simp_all⟩)
  (clean (band (wvar "answer") (Expr_ternary (num 1) mask mask))) (num 0)
def reservedBody := block [param "answer",Stmt_skip,block [ret reservedExpr]]
theorem reservedSource : reservedFn.body=reservedBody.value := reservedBody.sound _ (by native_decide)
theorem andValue (check : Bool) (x y : Nat) (X : x<R) (Y : y<R) :
    BinaryOp.apply check .bitAnd (.word x) (.word y)=.ok (.word (x &&& y)) := by
  have h := Inv32WideWords.andWord (bv x) (bv y)
  simp only [BitVec.toNat_and,Inv32WideAdapters.toNat _ X,Inv32WideAdapters.toNat _ Y] at h
  cases check <;> exact h
set_option maxRecDepth 4096 in
set_option maxHeartbeats 2000000 in
theorem maskRead (c : Context) (r : Runtime) : Inv40.Reads c r (Expr_ternary (num 1) mask mask).value ((2^15-1) <<< 240) := by
  intro fuel enough
  change 22≤fuel at enough
  obtain ⟨n,E⟩ := Nat.exists_eq_add_of_le enough
  rw [Nat.add_comm] at E
  subst fuel
  cases C : c.checked <;>
    simp [EvmCompiler.Simulation.Interaction.bind,EvmCompiler.Simulation.Interaction.pure,Expr_ternary,mask,twice,MulDiv.twice,Add.uintConvert,shl,sub,num,clean,Expr_binary,Expr_castOp,Expr_word,CastKind_uintCleanup,CastKind_uintCast,BinaryOp_sub,lit,
      Expr.evalFuel,Inv08.Authority.bindPure,Inv08.Authority.liftPure,BinaryOp.apply,BinaryOp.applyWord,
      Value.forceAbiLazy,Value.asStorageWord?,uintCleanup?,uintCast?,Bind.bind,Except.bind,C]
    <;> rfl

theorem reservedRead (c : Context) (r : Runtime) (n k : Nat) (N : n<Answer.radix) (valid : k≤n)
    (input : r.lookupLocal? "answer"=some (.word (Answer.encode n k))) :
    Inv40.Reads c r reservedExpr.value 0 := by
  have E := Answer.fit n k N valid
  have maskFit : (2^15-1) <<< 240 < R := by decide
  have bits := Inv08.ReleaseQuote.binary (MulDiv.wordVar c r "answer" (Answer.encode n k) E input) (maskRead c r)
    .bitAnd (by intro h;cases h) (by intro h;cases h) (andValue c.checked _ _ E maskFit)
  rw [Answer.reserved n k N valid] at bits
  have cleanBits := Inv08.ReleaseQuote.readClean bits (by decide : 0<R)
  exact Inv08.ReleaseQuote.binary cleanBits (Inv08.Authority.literal c r 0 (by decide)) .ne
    (by intro h;cases h) (by intro h;cases h) rfl
def reservedEntry (r : Runtime) (a : Nat) := r.withFrame [("answer",.word a),("_ret0",.word 0)]
theorem reservedExecution (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat) (N : n<Answer.radix) (valid : k≤n) :
    Stmt.eval (fuel+4) model.core.table c (reservedEntry r (Answer.encode n k)) reservedFn.body=
      pure (.returned (reservedEntry r (Answer.encode n k)) [.word 0]) := by
  let s := reservedEntry r (Answer.encode n k)
  let t := model.core.table
  have cleanup := Inv32FloorFastPath.cleanParamExec (fuel+2) t c s.pushScope "answer" _ (Answer.fit n k N valid) rfl
    (by simp [s,reservedEntry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have skip : Stmt.eval (fuel+3) t c s.pushScope .skip=pure (.normal s.pushScope) := by rw [Stmt.eval]
  have reading := reservedRead c s.pushScope.pushScope n k N valid rfl
  have ret : Stmt.eval (fuel+2) t c s.pushScope.pushScope (Inv03.Bodies.ret reservedExpr).value=
      pure (.returned s.pushScope.pushScope [.word 0]) := by
    change Stmt.eval _ _ _ _ (.returnValues [_])=_
    rw [Stmt.eval];dsimp only
    have leaf : Expr.evalReturnValue c s.pushScope.pushScope reservedExpr.value=pure (.word 0,s.pushScope.pushScope) := reading _ (Nat.le_succ _)
    have args : Expr.evalReturnList c s.pushScope.pushScope [reservedExpr.value]=pure ([.word 0],s.pushScope.pushScope) := by
      change Expr.evalReturnListFuel (_+1+1) _ _ [_]=_
      simp only [Expr.evalReturnListFuel,leaf,Inv08.Authority.bindPure]
    rw [args];rfl
  have block := Inv32FloorFastPath.blockReturned (fuel+2) t c s.pushScope s.pushScope.pushScope _ [.word 0]
    (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ ret)
  rw [reservedSource]
  have h := Inv32FloorFastPath.blockReturned (fuel+3) t c s s.pushScope _ [.word 0] (by
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cleanup).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip).trans
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ block)
  simpa [s,reservedEntry,Runtime.withFrame,Runtime.pushScope,Runtime.popScope] using h
private def reservedSig : List BindingDecl→List BindingDecl→Bool
  | [⟨"answer",.uint256,false⟩],[⟨"_ret0",.bool,false⟩]=>true
  | _,_=>false
theorem reservedSignature : reservedFn.params=[⟨"answer",.uint256,false⟩] ∧ reservedFn.returns=[⟨"_ret0",.bool,false⟩] := by
  have h : reservedSig reservedFn.params reservedFn.returns := by native_decide
  generalize reservedFn.params=ps at *;generalize reservedFn.returns=rs at *
  unfold reservedSig at h;split at h <;> simp_all
theorem reservedCall (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat) (name : String) (targets : List String)
    (N : n<Answer.radix) (valid : k≤n) (input : r.lookupLocal? name=some (.word (Answer.encode n k))) :
    Stmt.eval (fuel+5) model.core.table c r (.internalCall targets reservedKey [.var name])=internalCallAssign r targets [.word 0] := by
  let empty := {r with locals:=[]}
  have found : model.core.table.lookup? reservedKey=some reservedFn := (Option.some_get reservedPresent).symm
  have args : Expr.evalRefArgList c r [.var name]=pure ([.word (Answer.encode n k)],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var name]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,
      Inv32ProductCall.wordArg _ _ _ _ input,Inv08.Authority.bindPure]
  obtain ⟨ps,rs⟩ := reservedSignature
  have enter : internalCallEnter? reservedFn [.word (Answer.encode n k)] r=some (reservedEntry empty (Answer.encode n k),r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs];simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
      Ty.coerceValue?,Ty.defaultValue,reservedEntry,empty,Runtime.withFrame]
  have ev := reservedExecution fuel {c with checked:=true} empty n k N valid
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,reservedEntry,empty,Runtime.withFrame]
  all_goals rfl
#print axioms reservedCall
end Inv45.Public
