import Inv39AuthSlots
import Inv39AllowanceRead
import Inv39RawAuth
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
def fieldExpr (i : Nat) := (Source.Expr.var target).index (.word i)
def mapExpr (i : Nat) (owner : String) := (fieldExpr i).index (.var owner)
def flagExpr (owner : String) := (mapExpr 1 owner).index (.var "nonce")
def flagPlace (owner : String) := ((Source.LValue.var target).index (.word 1)).index (.var owner) |>.index (.var "nonce")
private theorem okBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem ptrBase (r : Runtime) (pointer : r.lookupLocal? target=some ptr) : r.lookupStorageBase? target=some root := by
  simp [Runtime.lookupStorageBase?,pointer,ptr,root]
theorem basePlace (n : Nat) (c : Context) (r : Runtime) (pointer : r.lookupLocal? target=some ptr) :
    Expr.resolveLValueFuel (n+1) c r (.var target)=pure (.storageSlotPath position layout [],r) := by
  rw [Expr.resolveLValueFuel,ptrBase _ pointer]
theorem fieldPlace (n i : Nat) (c : Context) (r : Runtime) (pointer : r.lookupLocal? target=some ptr) :
    Expr.resolveLValueFuel (n+2) c r (fieldExpr i)=pure (.storageSlotPath position layout [.word (normWord i)],r) := by
  unfold fieldExpr; rw [Expr.resolveLValueFuel]; simp only [basePlace n c r pointer,okBind]; rw [Expr.evalFuel]; rfl
theorem mapPlace (n i o : Nat) (c : Context) (r : Runtime) (owner : String)
    (pointer : r.lookupLocal? target=some ptr) (O : r.lookupLocal? owner=some (.word o)) :
    Expr.resolveLValueFuel (n+3) c r (mapExpr i owner)=pure (.storageSlotPath position layout [.word (normWord i),.word o],r) := by
  unfold mapExpr; rw [Expr.resolveLValueFuel]; simp only [fieldPlace n i c r pointer,okBind,Inv32Guards.readWord _ _ _ _ _ O]; rfl
theorem bytesVar (n v : Nat) (c : Context) (r : Runtime) (name : String)
    (ref : r.lookupLocal? name=some (.fixedBytes 32 v)) :
    Expr.evalFuel (n+1) c r (.var name)=pure (.fixedBytes 32 v,r) := by
  rw [Expr.evalFuel]; simp [Runtime.lookupStorageBase?,ref,Runtime.derefMemoryValue]; rfl
theorem flagPlaceResolved (n o nonce : Nat) (c : Context) (r : Runtime) (owner : String) (pointer : r.lookupLocal? target=some ptr)
    (O : r.lookupLocal? owner=some (.word o)) (N : r.lookupLocal? "nonce"=some (.fixedBytes 32 nonce)) :
    Expr.resolveLValueFuel (n+4) c r (flagExpr owner)=pure (.storageSlotPath position layout [.word 1,.word o,.fixedBytes 32 nonce],r) := by
  unfold flagExpr; rw [Expr.resolveLValueFuel]; simp only [mapPlace n 1 o c r owner pointer O,okBind,bytesVar _ _ _ _ _ N]; rfl
end Inv39.Auth
