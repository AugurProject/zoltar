import Inv39SupplyFields
import Inv39Slots
import Inv40Evaluation
import Inv32QuoteExpr
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
def updateExpr (field : WordField.Field) (op : Source.BinaryOp) (name : String) : Source.Expr :=
  .assignment (some op) (some (.uint 256)) (.storage field.name) (.var name)
private theorem here (c : Context) (k : WordField.Field)
    (layout : model.core.context.storageField? k.name = some k.field)
    (fields : c.storageFields = model.core.context.storageFields) :
    c.storageField? k.name = some k.field := by
  change c.storageFields.find? _ = _
  rw [fields]; exact layout
theorem increment (c : Context) (r : Runtime) (name : String) (a fuel : Nat)
    (value : r.lookupLocal? name=some (.word a))
    (fit : WordField.stored r.state circulating + a < R) (fields : c.storageFields=model.core.context.storageFields) :
    let newSupply := WordField.stored r.state circulating+a
    (updateExpr circulating .add name).evalFuel (fuel+2) c r =
      pure (.word newSupply,{r with state:=r.state.storeSlot circulating.slot newSupply}) := by
  exact WordField.compound _ _ _ _ _ _ _ .add (here _ _ layout.1 fields) fit
    (Inv32Guards.readWord _ _ _ _ _ value) (Inv40.addWords _ _ _ fit)
theorem decrement (c : Context) (r : Runtime) (k : WordField.Field) (name : String) (a fuel : Nat)
    (known : model.core.context.storageField? k.name = some k.field) (fields : c.storageFields=model.core.context.storageFields)
    (value : r.lookupLocal? name=some (.word a)) (enough : a≤WordField.stored r.state k)
    (fit : WordField.stored r.state k<R) :
    let newSupply := WordField.stored r.state k-a
    (updateExpr k .sub name).evalFuel (fuel+2) c r =
      pure (.word newSupply,{r with state:=r.state.storeSlot k.slot newSupply}) := by
  exact WordField.compound _ _ _ _ _ _ _ .sub (here _ _ known fields) (lt_of_le_of_lt (Nat.sub_le _ _) fit)
    (Inv32Guards.readWord _ _ _ _ _ value) (Inv32QuoteExpr.subWord _ _ _ fit (lt_of_le_of_lt enough fit) enough)
end Inv39
