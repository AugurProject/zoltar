import Inv39Assignment
import Inv39UpdateBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.ERC20
theorem uncheckedStmt (t : FunctionTable) (c : Context) (r post : Runtime) (n : Nat) (s : Source.Stmt)
    (ok : Stmt.eval n t {c with checked := false} r s = pure (.normal post)) :
    Stmt.eval (n+1) t c r (.unchecked s) = pure (.normal post) := by rw [Stmt.eval]; exact ok
theorem expressionStmt (t : FunctionTable) (c : Context) (r post : Runtime) (n : Nat) (e : Source.Expr) (v : Nat)
    (ok : e.eval c r = pure (.word v,post)) :
    Stmt.eval (n+1) t c r (.exprStmt e) = pure (.normal post) := by rw [Stmt.eval]; dsimp only; rw [ok]; rfl
theorem mintRun (t : FunctionTable) (c : Context) (r : Runtime) (fuel a : Nat)
    (qty : r.lookupLocal? "value"=some (.word a))
    (fit : r.state.loadSlot circulating.slot+a<R) (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (fuel+2) t c r mint.value = pure (.normal {r with state:=r.state.storeSlot circulating.slot (r.state.loadSlot circulating.slot+a)}) :=
  Inv32Blocks.one _ _ _ _ _ _ (incrementStatement _ r.pushScope _ _ _ qty fit fields)
theorem burnRun (t : FunctionTable) (c : Context) (r : Runtime) (fuel a : Nat)
    (qty : r.lookupLocal? "value"=some (.word a)) (enough : a≤r.state.loadSlot circulating.slot)
    (fit : r.state.loadSlot circulating.slot<R) (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (fuel+4) t c r burn.value = pure (.normal {r with state:=r.state.storeSlot circulating.slot (r.state.loadSlot circulating.slot-a)}) := by
  let final := {r with state:=r.state.storeSlot circulating.slot (r.state.loadSlot circulating.slot-a)}
  apply Inv32Blocks.one (next:=final.pushScope)
  apply uncheckedStmt
  exact Inv32Blocks.one _ _ _ _ _ _ (decrementStatement {c with checked:=false} r.pushScope.pushScope _ _ _ _ _ layout.1 qty enough fit fields)
theorem creditRun (t : FunctionTable) (c : Context) (r : Runtime) (fuel addr a : Nat)
    (dst : r.lookupLocal? "to" = some (.word addr)) (qty : r.lookupLocal? "value"=some (.word a))
    (fit : r.state.loadSlot (balanceSlot addr)+a<R) (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (fuel+4) t c r credit.value = pure (.normal {r with state:=r.state.storeSlot (balanceSlot addr) (r.state.loadSlot (balanceSlot addr)+a)}) := by
  let final := {r with state:=r.state.storeSlot (balanceSlot addr) (r.state.loadSlot (balanceSlot addr)+a)}
  apply Inv32Blocks.one (next:=final.pushScope)
  apply uncheckedStmt
  apply Inv32Blocks.one (next:=final.pushScope.pushScope)
  apply expressionStmt
  have ev : creditExpr.value.eval {c with checked:=false} r.pushScope.pushScope = _ :=
    creditMapping _ _ _ _ 4 dst qty fit fields
  exact ev
end Inv39.ERC20
