import Inv08StorageUpdate
import Inv08ReleaseWrites
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08
private theorem resolvedRead (c : Context) (r : Runtime) (k : Field)
    (lookup : c.storageField? k.name = some k.field) :
    (ResolvedLValue.storageField k.name).read c r = .ok (.word (stored r.state k)) := by
  have load : r.loadStorageField c k.name = .ok (.word (stored r.state k)) := by
    unfold Runtime.loadStorageField
    rw [lookup]
    rfl
  simp [ResolvedLValue.read,ResolvedLValue.readRaw,load,Bind.bind,Except.bind,Runtime.derefMemoryValue]
theorem resolvedWrite (c : Context) (r : Runtime) (k : Field) (v : Nat) (fit : v<R)
    (lookup : c.storageField? k.name = some k.field) (fields : c.storageFields=model.core.context.storageFields) :
    (ResolvedLValue.storageField k.name).write c r (.word v) = .ok {r with state:=r.state.storeFieldWord k.field v} := by
  have mat : r.storageMaterializedValue (.word v) = .ok (.word v) := by
    simp [Runtime.storageMaterializedValue, Runtime.derefMemoryValueDeep, Runtime.derefMemoryValueWithFuel]
  change r.storeStorageFieldWithDeepClear c k.name (.word v) = _
  unfold Runtime.storeStorageFieldWithDeepClear
  rw [lookup]
  simpa only [Bind.bind,Except.bind,mat] using writeField c r k v fit fields
private theorem bindOk {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl
theorem compound (c : Context) (r : Runtime) (k : Field) (fuel a v : Nat) (rhs : Source.Expr)
    (op : Source.BinaryOp) (fields : c.storageFields=model.core.context.storageFields) (fits : v<R)
    (evaluated : rhs.evalFuel (fuel+1) c r = pure (.word a,r))
    (applied : op.apply c.checked (.word (stored r.state k)) (.word a) = .ok (.word v)) :
    (Expr.assignment (some op) (some (.uint 256)) (.storage k.name) rhs).evalFuel (fuel+2) c r =
      pure (.word v,{r with state:=r.state.storeFieldWord k.field v}) := by
  have lookup : c.storageField? k.name = some k.field := by
    change c.storageFields.find? _ = _
    rw [fields]; exact fieldLookup k
  have resolve : Expr.resolveLValueFuel (fuel+1) c r (.storage k.name) = pure (.storageField k.name,r) := by
    simp [Expr.resolveLValueFuel]
  have cleanup (checked : Bool) : (ValueCleanup.uint 256).apply checked (.word v) = .ok (.word v) :=
    Inv32Guards.cleanupWord checked v fits
  rw [Expr.evalFuel,evaluated]
  simp only [liftOk,bindOk,resolve,resolvedRead c r k lookup,applied,cleanup,resolvedWrite c r k v fits lookup fields]
end Inv08
