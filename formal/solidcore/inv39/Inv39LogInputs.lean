import Inv39SupplyEvents
import Inv39EventEffect
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.SupplyEvents
private theorem bindOk {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl
def lastExpr : Source.Expr := .storageRead .load theoretical.name []
theorem lastRead (c : Context) (r : Runtime) (n : Nat) (fields : c.storageFields=model.core.context.storageFields) :
    lastExpr.evalFuel (n+2) c r = pure (.word (WordField.stored r.state theoretical),r) := by
  have found : c.storageField? theoretical.name = some theoretical.field := by
    change c.storageFields.find? _ = _
    rw [fields]; exact Inv39.layout.2
  have load : r.loadStorageField c theoretical.name = .ok (.word (WordField.stored r.state theoretical)) := by
    unfold Runtime.loadStorageField
    rw [found]
    rfl
  have empty : Expr.evalListFuel (n+1) c r [] = pure ([],r) := by rw [Expr.evalListFuel]
  rw [lastExpr,Expr.evalFuel]
  simp only [empty,bindOk,found]
  change (do let v ← liftM (r.loadStorageField c theoretical.name); pure (v,r) : SolI (Source.Value × Runtime)) = _
  rw [load]; rfl
def args : Kind → List Source.Expr
  | .mint => [.var "account",.var "valueAttoRep"]
  | .burn => [.var "account",.var "valueAttoRep",lastExpr]
def values (k : Kind) (s : State) (addr val : Nat) : List Source.Value := match k with
  | .mint => [.word addr,.word val]
  | .burn => [.word addr,.word val,.word (WordField.stored s theoretical)]
theorem logArgs (k : Kind) (c : Context) (r : Runtime) (addr val : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (account : r.lookupLocal? "account"=some (.word addr)) (qty : r.lookupLocal? "valueAttoRep"=some (.word val)) :
    Expr.evalList c r (args k) = pure (values k r.state addr val,r) := by
  cases k with
  | mint =>
    change Expr.evalListFuel 5 c r [.var "account",.var "valueAttoRep"] = _
    simp only [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ account,Inv32Guards.readWord _ _ _ _ _ qty,bindOk,values]
  | burn =>
    change Expr.evalListFuel 8 c r [.var "account",.var "valueAttoRep",lastExpr] = _
    simp only [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ account,Inv32Guards.readWord _ _ _ _ _ qty,
      lastRead _ _ _ fields,bindOk,values]
end Inv39.SupplyEvents
