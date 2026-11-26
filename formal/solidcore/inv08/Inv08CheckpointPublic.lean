import Inv08CheckpointPhases
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Checkpoint
private theorem normal3 (n : Nat) (t : FunctionTable) (c : Context) (a b d : Stmt)
    (r x y z : Runtime) (A : a.eval n t c r.pushScope = pure (.normal x))
    (B : b.eval n t c x = pure (.normal y)) (D : d.eval n t c y = pure (.normal z)) :
    (Stmt.block [a,b,d]).eval (n+1) t c r = pure (.normal z.popScope) :=
  Inv32Hoist.block n t c r z _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] D).trans (by rw [Stmt.evalList]))))
private theorem outer (n : Nat) (t : FunctionTable) (c : Context) (param nested : Stmt)
    (r z : Runtime) (P : param.eval (n+1) t c r.pushScope = pure (.normal r.pushScope))
    (N : nested.eval (n+1) t c r.pushScope = pure (.normal z)) :
    (Stmt.block [param,.skip,.skip,nested]).eval (n+2) t c r = pure (.normal z.popScope) := by
  have S : Stmt.eval (n+1) t c r.pushScope .skip = pure (.normal r.pushScope) := by rw [Stmt.eval]
  exact Inv32Hoist.block (n+1) t c r z _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] N).trans (by rw [Stmt.evalList])))))

def output (c : Context) (s : State) (tm now : Nat) :=
  let r := Release.baseRuntime c s
  {(result c (Authority.post c r) tm now).state with constructorOutput? := none}
private theorem postGuard (c : Context) (r : Runtime) (tm a b : Nat) :
    Authority.post c (guarded r tm a b)=guarded (Authority.post c r) tm a b := rfl
private theorem modEq : modifiers.value =
    .block [Authority.callerGuard.value,Authority.initializedGuard.value,captured.value] := rfl
theorem execute (n : Nat) (c : Context) (r : Runtime) (tm now : Nat) (time : EnvWord.blockTimestamp.eval c=now)
    (fields : c.storageFields=model.core.context.storageFields) (clone : Authority.Clone c r) (ready : Ready r.state tm now) :
    let dst := result c (Authority.post c r) tm now
    body.value.eval (n+79) model.core.table c (r.withFrame (frame tm 0 0)) =
      pure (.normal (dst.withFrame (frame tm (earned r.state tm true) (earned r.state tm false)))) := by
  let t := model.core.table
  let src := r.withFrame (frame tm 0 0)
  let copied := Authority.post c r
  let e := earned r.state tm true
  let p := earned r.state tm false
  let out := result c copied tm now
  let dst := out.withFrame (frame tm e p)
  have A := Authority.authorized (n+36) c (guarded r tm 0 0) clone
  have I := Authority.initialized (n+36) c (Authority.post c (guarded r tm 0 0)) fields ready.initialized
  rw [postGuard] at A I
  have B := phases n c copied tm now time fields clone ready
  have M0 := normal3 (n+76) t c Authority.callerGuard.value Authority.initializedGuard.value captured.value
    src.pushScope.pushScope (guarded copied tm 0 0) (guarded copied tm 0 0) (guarded out tm e p) A I B
  have M : modifiers.value.eval (n+77) t c src.pushScope.pushScope=pure (.normal dst.pushScope.pushScope) := by
    rw [modEq,M0]
    rfl
  have N : nested.value.eval (n+78) t c src.pushScope=pure (.normal dst.pushScope) :=
    Inv32Blocks.one (n+77) t c src.pushScope dst.pushScope.pushScope modifiers.value M
  have P := Inv32Assign.scalarCast (n+77) t c src.pushScope src.pushScope "eligibleThrough" tm tm _ _ _ rfl
    (Expiry.local48 c src.pushScope "eligibleThrough" tm ready.time rfl _ (Nat.le_succ _)) (by dsimp [src]; checkpoint_write)
  exact outer (n+77) t c _ nested.value src dst.pushScope P N

/-- The generated public checkpoint reports only the eligible release, then
credits both deferred balances with the subsequent stale release. -/
theorem checkpoint (n : Nat) (c : Context) (s : State) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (free : c.value=0)
    (clone : Authority.Clone c (Release.baseRuntime c s)) (ready : Ready (Release.entryState c s) tm (EnvWord.blockTimestamp.eval c)) :
    SolidCore.Solidity.TypeCheck.CheckedContract.callTargetWithContext? (n+79) model (.name "checkpoint") c s [.word tm] =
      some (.returned (output c s tm (EnvWord.blockTimestamp.eval c)) [.word (earned s tm true),.word (earned s tm false)]) := by
  let r := Release.baseRuntime c s
  let e := earned s tm true
  let p := earned s tm false
  let dst := (result c (Authority.post c r) tm (EnvWord.blockTimestamp.eval c)).withFrame (frame tm e p)
  have X := execute n c r tm (EnvWord.blockTimestamp.eval c) rfl fields clone ready
  change Stmt.eval _ _ _ _ body.value=pure (.normal dst) at X
  rw [←bodyFromSource] at X
  have noValue : fn.acceptsValue c.value=true := by rw [free]; simp [FunctionDef.acceptsValue,wordEq]
  have run : fn.evalBodyEntry (n+79) model.core.table c s [.word tm]=some (pure (.normal dst)) := by
    unfold FunctionDef.evalBodyEntry
    rw [noValue,initial]; exact congrArg some X
  have outputs : fn.collectReturns dst = .ok [.word e,.word p] := by
    unfold FunctionDef.collectReturns
    rw [results]
    simp [collectReturnBindings,collectReturnBindings.collect,Inv32Library.decl,dst,Runtime.lookupLocal?,
      Runtime.withFrame,frame,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,Bind.bind,Except.bind]
  unfold SolidCore.Solidity.TypeCheck.CheckedContract.callTargetWithContext?
  rw [dispatch]
  change fn.call? _ _ _ _ _ = _
  unfold FunctionDef.call? FunctionDef.call
  rw [run]
  change some (fn.callBodyResult s (.normal dst)) = _
  simp only [FunctionDef.callBodyResult,outputs,List.map_cons,List.map_nil,Value.untagFixedBytes]
  rfl
end Inv08.Checkpoint
