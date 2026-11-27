import Inv39MarkerSeparation
import Inv39CleanParameters
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker
def repValue : Source.Expr := .castOp .uintCleanup 256 (.var "repNumber_")
def repGuard : Source.Stmt := .requireStmt (.binary .ne repValue (.word 0)) (some "REP number must be non-zero")
def repStore : Source.Stmt := .assign (.storage "repNumber") repValue
/-- uint256 generated cleanup normalizes arbitrary natural-number calldata. -/
theorem cleanupWord (checked : Bool) (rep : Nat) :
    uintCleanup? checked 256 (.word rep)=.ok (.word (Shared.norm rep)) := by
  have fit : Shared.norm rep < 2^256 := Nat.mod_lt _ (by decide)
  norm_num at fit
  have idem : Shared.norm (Shared.norm rep)=Shared.norm rep := Nat.mod_mod _ _
  simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,Nat.not_le_of_gt fit,
    Nat.mod_eq_of_lt fit,idem,Bind.bind,Except.bind]
theorem cleanupRead (c : Context) (r : Runtime) (rep n : Nat)
    (read : r.lookupLocal? "repNumber_"=some (.word rep)) :
    repValue.evalFuel (n+2) c r=pure (.word (Shared.norm rep),r) := by
  rw [repValue,Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ read]
  change ((liftM (uintCleanup? c.checked 256 (.word rep)) : SolI Source.Value) >>= fun v=>pure (v,r))=_
  rw [cleanupWord]; rfl
/-- Exact successful generated argument-assignment step; no raw calldata range premise. -/
theorem cleanupExec (c : Context) (r next : Runtime) (rep n : Nat)
    (read : r.lookupLocal? "repNumber_"=some (.word rep))
    (write : r.assignLocal? "repNumber_" (.word (Shared.norm rep))=some next) :
    Stmt.eval (n+1) model.core.table c r (Repeat.cleanup 256 "repNumber_")=pure (.normal next) := by
  exact Inv32Assign.scalarCast _ _ _ _ _ _ _ _ _ _ _ read (cleanupRead c r rep 1 read) write
theorem guardExec (c : Context) (r : Runtime) (rep n : Nat)
    (read : r.lookupLocal? "repNumber_"=some (.word rep)) :
    Stmt.eval (n+1) model.core.table c r repGuard =
      pure (if Shared.norm rep=0 then .reverted r (.error "REP number must be non-zero") else .normal r) := by
  have applied : Source.BinaryOp.apply c.checked .ne (.word (Shared.norm rep)) (.word 0)=
      .ok (.word (boolWord (Shared.norm rep≠0))) := by
    change (Except.ok (.word (boolWord (!(wordEq (Shared.norm rep) 0)))) : Except RevertData Source.Value)=_
    simp [wordEq,Shared.norm,boolWord]
  have cond : (Source.Expr.binary .ne repValue (.word 0)).eval c r=
      pure (.word (boolWord (Shared.norm rep≠0)),r) := by
    apply Inv32Eval.binary 4 c r .ne (by intro h; cases h) (by intro h; cases h) _ _ _ _ _
      (cleanupRead c r rep 2 read) _ applied
    rw [Source.Expr.evalFuel]; rfl
  have h := Inv32QuoteGuard.requireEval n model.core.table c r _ (decide (Shared.norm rep≠0)) "REP number must be non-zero" cond
  by_cases zero : Shared.norm rep=0 <;> simpa [repGuard,zero] using h
/-- A normal result of the actual generated guard forces a nonzero normalized argument. -/
theorem guardNonzero (c : Context) (r next : Runtime) (rep n : Nat)
    (read : r.lookupLocal? "repNumber_"=some (.word rep))
    (run : SolI.runWith [] (Stmt.eval (n+1) model.core.table c r repGuard)=.ok (.normal next)) :
    Shared.norm rep≠0 := by
  rw [guardExec c r rep n read] at run
  by_contra zero
  rw [if_pos zero] at run
  have impossible : Fold.Ensures (pure (Result.reverted r (.error "REP number must be non-zero")))
      (fun res => match res with | .reverted _ _ => True | _ => False) := Fold.pureValue _ _ trivial
  unfold Fold.Ensures at impossible
  exact impossible _ run

/-- The actual resolved storage write is a full uint256 store into fixed slot 7. -/
theorem markerWrite (c : Context) (r : Runtime) (rep : Nat)
    (fields : c.storageFields=model.core.context.storageFields) :
    (ResolvedLValue.storageField "repNumber").write c r (.word (Shared.norm rep))=
      .ok {r with state:=r.state.storeSlot 7 (Shared.norm rep)} := by
  have lookup : c.storageField? "repNumber"=some (field .number) := by
    change c.storageFields.find? _ = _; rw [fields]; exact layout .number
  have fit : Shared.norm rep<R := Nat.mod_lt _ (by decide)
  have mat : r.storageMaterializedValue (.word (Shared.norm rep))=.ok (.word (Shared.norm rep)) := by
    simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel]
  have conv : coerceStorageWordAs .uint256 (.word (Shared.norm rep))=.ok (Shared.norm rep) := by
    simp [coerceStorageWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,
      Shared.norm,Bind.bind,Except.bind]
  change r.storeStorageFieldWithDeepClear c "repNumber" (.word (Shared.norm rep))=_
  simp [Runtime.storeStorageFieldWithDeepClear,Runtime.storeStorageField,lookup,mat,conv,
    field,kind,scalar,slot,wordBytes,State.storeFieldWord,State.storeFieldSlot,StorageField.isPacked,
    Bind.bind,Except.bind]
theorem storeExec (c : Context) (r : Runtime) (rep n : Nat)
    (fields : c.storageFields=model.core.context.storageFields)
    (read : r.lookupLocal? "repNumber_"=some (.word rep)) :
    Stmt.eval (n+1) model.core.table c r repStore=
      pure (.normal {r with state:=r.state.storeSlot 7 (Shared.norm rep)}) := by
  have rhs : repValue.eval c r=pure (.word (Shared.norm rep),r) := cleanupRead c r rep 1 read
  have resolved : (LValue.storage "repNumber").resolveWithRuntime c r=pure (.storageField "repNumber",r) := by
    rfl
  rw [repStore,Stmt.eval]
  dsimp only
  simp only [LValue.wantsMemoryRefRhs, rhs]
  change (do
    match ← ((LValue.storage "repNumber").resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.word (Shared.norm rep)) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [resolved]
  change (match (ResolvedLValue.storageField "repNumber").write c r (.word (Shared.norm rep)) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err))=_
  rw [markerWrite c r rep fields]

end Inv39.Init.Marker
