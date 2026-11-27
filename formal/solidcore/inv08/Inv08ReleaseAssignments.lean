import Inv08ReleaseState
open SolidCore.Solidity.Source Inv32Shapes Inv32Division
namespace Inv08.Release
def credit (eth : Bool) := ReleaseWrites.update BinaryOp_add (cursorField eth).name (ReleaseWrites.increment (amountLocal eth))
def subtract (eth : Bool) := ReleaseWrites.update BinaryOp_sub (outstandingField eth).name (Inv03.Bodies.varP (amountLocal eth))

private theorem exprStmt (n : Nat) (t : FunctionTable) (c : Context) (r post : Runtime) (e : Expr) (v : Nat)
    (eval : e.eval c r = pure (.word v,post)) : Stmt.eval (n+1) t c r (.exprStmt e) = pure (.normal post) := by
  rw [Stmt.eval]; dsimp only; rw [eval]; rfl

theorem creditRuns (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (eth : Bool) (a : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (found : r.lookupLocal? (amountLocal eth)=some (.word a))
    (fit : a<R) (bound : stored r.state (cursorField eth)+a*stored r.state .duration<R) :
    let k := cursorField eth
    let v := stored r.state k+a*stored r.state .duration
    (credit eth).value.eval (n+1) t c r = pure (.normal {r with state:=r.state.storeFieldWord k.field v}) := by
  apply exprStmt
  exact advance c r eth a 10 fields found fit bound (by cases eth <;> decide)

theorem subtractRuns (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (eth : Bool) (a : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (found : r.lookupLocal? (amountLocal eth)=some (.word a))
    (funded : a≤stored r.state (outstandingField eth)) (fit : stored r.state (outstandingField eth)<R) :
    let k := outstandingField eth
    let v := stored r.state k-a
    (subtract eth).value.eval (n+1) t c r = pure (.normal {r with state:=r.state.storeFieldWord k.field v}) := by
  apply exprStmt
  exact debit c r eth a 3 fields found funded fit

theorem recordRuns (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (k : Field) (name : String) (v : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (found : r.lookupLocal? name=some (.word v)) (fit : v<2^48) :
    (ReleaseWrites.record48 k.name name).value.eval (n+1) t c r =
      pure (.normal {r with state:=r.state.storeFieldWord k.field v}) := by
  have lookup : c.storageField? k.name = some k.field := by
    change c.storageFields.find? _ = _
    rw [fields]; exact fieldLookup k
  have res : (LValue.storage k.name).resolveWithRuntime c r = pure (.storageField k.name,r) := by
    change Expr.resolveLValueFuel 3 c r (.storage k.name) = _
    simp [Expr.resolveLValueFuel]
  have V := Expiry.local48 c r name v fit found _ (Nat.le_succ _)
  change Expr.eval c r (.castOp .uintCleanup 48 (.var name)) = pure (.word v,r) at V
  change Stmt.eval _ _ _ _ (.assign (.storage k.name) (.castOp .uintCleanup 48 (.var name))) = _
  rw [Stmt.eval]; dsimp only
  simp only [LValue.wantsMemoryRefRhs,Bool.false_eq_true,if_false,V]
  change (do match ← ((LValue.storage k.name).resolveWithRuntime c r).caught with
             | .ok (target,r') => match target.write c r' (.word v) with
               | .ok updated => pure (Result.normal updated)
               | .error err => pure (Result.reverted r err)
             | .error err => pure (Result.reverted r err)) = _
  rw [res]
  change (match (ResolvedLValue.storageField k.name).write c r (.word v) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (.reverted r err)) = _
  rw [resolvedWrite _ _ _ _ (lt_trans fit (by decide)) lookup fields]
end Inv08.Release
