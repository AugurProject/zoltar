import Inv39Mapping
import Inv39Terms
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
private theorem okBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl
theorem readMapping (c : Context) (r : Runtime) (name : String) (a fuel : Nat)
    (localA : r.lookupLocal? name=some (.word a)) (fields : c.storageFields=model.core.context.storageFields) :
    (.storageIndex "_balances" (.var name) : Source.Expr).evalFuel (fuel+2) c r =
      pure (.word (r.state.loadSlot (balanceSlot a)),r) := by
  unfold Expr.storageIndex
  rw [Expr.evalFuel]
  simp only [Inv32Guards.readWord _ _ _ _ _ localA,okBind,readBalance _ _ _ fields,liftOk]
theorem resolveMapping (c : Context) (r : Runtime) (name : String) (a fuel : Nat)
    (localA : r.lookupLocal? name=some (.word a)) :
    Expr.resolveLValueFuel (fuel+2) c r (.storageIndex "_balances" (.var name)) =
      pure (.storageIndex "_balances" (.word a),r) := by
  simp only [Expr.resolveLValueFuel,Inv32Guards.readWord _ _ _ _ _ localA,okBind]
theorem creditMapping (c : Context) (r : Runtime) (a qty fuel : Nat)
    (localA : r.lookupLocal? "to"=some (.word a)) (localQ : r.lookupLocal? "value"=some (.word qty))
    (fits : r.state.loadSlot (balanceSlot a)+qty<R) (fields : c.storageFields=model.core.context.storageFields) :
    let post := r.state.loadSlot (balanceSlot a)+qty
    (Expr.assignment (some .add) (some (.uint 256)) (.storageIndex "_balances" (.var "to")) (.var "value")).evalFuel
      (fuel+3) c r = pure (.word post,{r with state := r.state.storeSlot (balanceSlot a) post}) := by
  dsimp only
  have read : (ResolvedLValue.storageIndex "_balances" (.word a)).read c r =
      .ok (.word (r.state.loadSlot (balanceSlot a))) := by
    simp [ResolvedLValue.read,ResolvedLValue.readRaw,readBalance _ _ _ fields,Bind.bind,Except.bind,Runtime.derefMemoryValue]
  have store : (ResolvedLValue.storageIndex "_balances" (.word a)).write c r (.word (r.state.loadSlot (balanceSlot a)+qty)) =
      .ok {r with state := r.state.storeSlot (balanceSlot a) (r.state.loadSlot (balanceSlot a)+qty)} :=
    writeBalance _ _ _ _ fits fields
  rw [Expr.evalFuel]
  simp only [Inv32Guards.readWord _ _ _ _ _ localQ,resolveMapping _ _ _ _ _ localA,read,okBind,
    liftOk,Inv40.addWords _ _ _ fits,ValueCleanup.apply,Inv32Guards.cleanupWord _ _ fits,store]
end Inv39
