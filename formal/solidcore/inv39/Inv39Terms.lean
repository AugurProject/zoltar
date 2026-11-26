import Inv39SupplyWrites
import Inv32WideGuards
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
def zeroTest (name : String) : Source.Expr := .binary .eq (.var name) (.word 0)
theorem zeroResult (c : Context) (r : Runtime) (name : String) (v : Nat)
    (fit : v<R) (look : r.lookupLocal? name=some (.word v)) :
    (zeroTest name).eval c r = pure (.word (boolWord (v=0)),r) := by
  have h := Inv32WideGuards.eqWord c.checked v 0 fit (by decide)
  have prim : Source.BinaryOp.apply c.checked .eq (.word v) (.word 0) = .ok (.word (boolWord (v=0))) := by
    by_cases z : v=0 <;> simpa [z,boolWord] using h
  exact Inv32Eval.binary 3 c r .eq (by intro h; cases h) (by intro h; cases h) _ _ _ _ _
    (Inv32Guards.readWord 2 _ _ _ _ look) (by rw [Source.Expr.evalFuel]; rfl) prim
theorem incrementStatement (c : Context) (r : Runtime) (t : FunctionTable) (fuel a : Nat)
    (value : r.lookupLocal? "value"=some (.word a))
    (fit : WordField.stored r.state circulating + a < R) (fields : c.storageFields=model.core.context.storageFields) :
    let newSupply := WordField.stored r.state circulating+a
    Stmt.eval (fuel+1) t c r (.exprStmt (updateExpr circulating .add "value")) =
      pure (.normal {r with state:=r.state.storeSlot circulating.slot newSupply}) := by
  have ev : (updateExpr circulating .add "value").eval c r = _ := increment c r _ a 3 value fit fields
  rw [Stmt.eval]
  simp only [ev]
  rfl
theorem decrementStatement (c : Context) (r : Runtime) (k : WordField.Field) (t : FunctionTable)
    (fuel a : Nat) (name : String) (known : model.core.context.storageField? k.name = some k.field)
    (value : r.lookupLocal? name=some (.word a))
    (enough : a≤WordField.stored r.state k) (fit : WordField.stored r.state k<R)
    (fields : c.storageFields=model.core.context.storageFields) :
    let newSupply := WordField.stored r.state k-a
    Stmt.eval (fuel+1) t c r (.exprStmt (updateExpr k .sub name)) =
      pure (.normal {r with state:=r.state.storeSlot k.slot newSupply}) := by
  have ev : (updateExpr k .sub name).eval c r = _ := decrement c r k name a 3 known fields value enough fit
  rw [Stmt.eval]
  simp only [ev]
  rfl
end Inv39
