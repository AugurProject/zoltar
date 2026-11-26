import Inv08TakeDeferredShape
import Inv08TakeDeferredState
import Inv08AddStreamGuards
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.TakeDeferred
def root (r : Runtime) (a b : Nat) := (r.withFrame (frame a b)).pushScope.pushScope.pushScope.pushScope
def guarded (r : Runtime) (a b : Nat) := (r.withFrame (frame a b)).pushScope.pushScope.pushScope
private theorem clearOne (n : Nat) (c : Context) (r : Runtime) (eth : Bool) (fields : c.storageFields=model.core.context.storageFields) :
    let k := Checkpoint.deferredField eth
    (clear eth).value.eval (n+1) model.core.table c r=pure (.normal {r with state:=r.state.storeFieldWord k.field 0}) := by
  let k := Checkpoint.deferredField eth
  have lookup : c.storageField? k.name=some k.field := by
    change c.storageFields.find? _ = _; rw [fields]; exact fieldLookup k
  have res : (LValue.storage k.name).resolveWithRuntime c r=pure (.storageField k.name,r) := by
    change Expr.resolveLValueFuel 3 c r (.storage k.name) = _
    simp [Expr.resolveLValueFuel]
  have V : Expr.eval c r (.word 0)=pure (.word 0,r) := by rfl
  change Stmt.eval _ _ _ _ (.assign (.storage k.name) (.word 0)) = _
  rw [Stmt.eval]; dsimp only
  simp only [LValue.wantsMemoryRefRhs,Bool.false_eq_true,if_false,V]
  change (do match ← ((LValue.storage k.name).resolveWithRuntime c r).caught with
             | .ok (target,r') => match target.write c r' (.word 0) with
               | .ok updated => pure (Result.normal updated)
               | .error err => pure (Result.reverted r err)
             | .error err => pure (Result.reverted r err)) = _
  rw [res]
  change (match (ResolvedLValue.storageField k.name).write c r (.word 0) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (.reverted r err)) = _
  rw [resolvedWrite _ _ _ _ (by decide) lookup fields]

macro "withdraw_assign" : tactic => `(tactic|
  simp [root,guarded,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
    LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,frame,Value.coerceLike?])

private theorem copies (n : Nat) (c : Context) (r dest : Runtime) (eth : Bool)
    (fields : c.storageFields=model.core.context.storageFields) (v : Nat) (field : stored r.state (Checkpoint.deferredField eth)=v)
    (fits : v<R) (old : r.lookupLocal? (amountLocal eth)=some (.word 0))
    (up : r.assignLocal? (amountLocal eth) (.word v)=some dest) :
    (copy eth).value.eval (n+1) model.core.table c r=pure (.normal dest) := by
  have read := reads c r (Checkpoint.deferredField eth) fields
  rw [field] at read
  exact Inv32Assign.scalarCast n _ _ r dest _ 0 v _ _ _ old
    (ReleaseQuote.readClean read fits _ (Nat.le_succ _)) up

private theorem afterGuards (n : Nat) (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields)
    (ef : stored r.state .ethDeferred<R) (rf : stored r.state .repDeferred<R) :
    let a := stored r.state .ethDeferred
    let b := stored r.state .repDeferred
    captured.value.eval (n+3) model.core.table c (guarded r 0 0) =
      pure (.normal {guarded r a b with state:=post r.state}) := by
  let a := stored r.state .ethDeferred
  let b := stored r.state .repDeferred
  let before := root r 0 0
  let first := root r a 0
  let both := root r a b
  let x := {both with state:=r.state.storeFieldWord Field.ethDeferred.field 0}
  let y := {both with state:=post r.state}
  have A := copies n c before first true fields a rfl ef rfl (by dsimp [before,first,amountLocal]; withdraw_assign)
  have B := copies n c first both false fields b rfl rf rfl (by dsimp [first,both,amountLocal]; withdraw_assign)
  have C : (clear true).value.eval (n+1) model.core.table c both=pure (.normal x) := clearOne n c both true fields
  have D : (clear false).value.eval (n+1) model.core.table c x=pure (.normal y) := clearOne n c x false fields
  have blockRun : inner.value.eval (n+2) model.core.table c (guarded r 0 0)=pure (.normal y.popScope) := by
    apply Inv32Hoist.block (n+1) _ _ _ y _
    apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ A)
    apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ B)
    apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ C)
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] D).trans (by rw [Stmt.evalList])
  exact Inv32Internal.capture _ _ _ _ _ _ _ blockRun

theorem execute (n : Nat) (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields) (clone : Authority.Clone c r)
    (positive : 0<stored r.state .duration) (ef : stored r.state .ethDeferred<R) (rf : stored r.state .repDeferred<R) :
    let a := stored r.state .ethDeferred
    let b := stored r.state .repDeferred
    body.value.eval (n+43) model.core.table c (r.withFrame (frame 0 0)) =
      pure (.normal {(Authority.post c r).withFrame (frame a b) with state:=post r.state}) := by
  let t := model.core.table
  let base := r.withFrame (frame 0 0)
  let a := stored r.state .ethDeferred
  let b := stored r.state .repDeferred
  let copied := Authority.post c r
  let x := guarded r 0 0
  let dst := {guarded copied a b with state:=post r.state}
  have W := afterGuards (n+37) c copied fields ef rf
  change Stmt.eval (n+40) t c (Authority.post c x) captured.value=pure (.normal dst) at W
  have auth := Authority.onlyCapitalLedger n c x [captured.value] clone fields positive
  have run : Stmt.evalList (n+40) t c x [Authority.callerGuard.value,Authority.initializedGuard.value,captured.value] =
      pure (.normal dst) := auth.trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] W).trans (by rw [Stmt.evalList]))
  have M : modifierBody.value.eval (n+41) t c base.pushScope.pushScope = pure (.normal dst.popScope) := Inv32Hoist.block _ _ _ _ dst _ run
  have N := Inv32Blocks.one (n+41) t c base.pushScope dst.popScope modifierBody.value M
  exact Inv32Blocks.skips (n+41) t c base dst.popScope.popScope _ N
end Inv08.TakeDeferred
