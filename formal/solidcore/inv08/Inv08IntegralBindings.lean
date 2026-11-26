import Inv08SearchCall
import Inv08IntegralState
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies Inv32Division
namespace Inv08.Integral
def key := "__internal__integral(uint48,uint48)#[SolidCore.Solidity.Ty.uint 48, SolidCore.Solidity.Ty.uint 48]"
def loadLast : Pattern Expr :=
  ⟨.storageRead .load "lastExpiryId" [], fun | .storageRead .load "lastExpiryId" [] => true | _ => false,
    by intro x h; dsimp only at h; split at h <;> simp_all⟩
def aliasPath (name : String) (p : Pattern Expr) : Pattern Stmt :=
  ⟨.storageAliasPath name "expiries" [p.value], fun | .storageAliasPath n "expiries" [e] => n==name && p.test e | _ => false,
    by intro x h; dsimp only at h; split at h <;> simp_all; exact p.sound _ h.2⟩
def setup := [aliasPath "latest" loadLast, aliasPath "expired" (varP "expiredId"),
  assign "ethIntegralNumerator" (value true),assign "repIntegralNumerator" (value false)]
def body := block [assign "timestamp" (Expiry.w48 "timestamp"),assign "expiredId" (Expiry.w48 "expiredId"),
  Stmt_skip,Stmt_skip,block setup]
theorem link : Inv32Library.LinkAt model.core.table key [.word "timestamp",.word "expiredId"]
    [.word "ethIntegralNumerator",.word "repIntegralNumerator"] body.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some body).sound _ (by native_decide))

private theorem bindOk {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
theorem lastRead (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields) :
    Inv40.Reads c r loadLast.value (stored r.state .latest) := by
  have lookup : c.storageField? "lastExpiryId" = some Field.latest.field := by
    change c.storageFields.find? _ = _
    rw [fields]; exact fieldLookup .latest
  have read : r.loadStorageField c "lastExpiryId" = .ok (.word (stored r.state .latest)) := by
    unfold Runtime.loadStorageField; rw [lookup]; rfl
  intro fuel enough
  change 2≤fuel at enough
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le enough
  rw [Nat.add_comm]
  change Expr.evalFuel (n+2) c r (.storageRead .load "lastExpiryId" []) = _
  rw [Expr.evalFuel]
  simp only [Expr.evalListFuel,bindOk,lookup,List.isEmpty_nil,Bool.true_and,Field.field,if_true,read]
  rfl
theorem bind (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) (id : Nat) (e : Expr)
    (fit : id<R) (fields : c.storageFields=model.core.context.storageFields) (value : Inv40.Reads c r e id) :
    Stmt.eval (n+1) t c r (.storageAliasPath name "expiries" [e]) =
      pure (.normal (r.declareLocal name (.storageSlotRef (mappingStorageSlot 7 id) ExpiryStorage.layout))) := by
  have list : Expr.evalList c r [e] = pure ([.word id],r) := by
    unfold Expr.evalList
    change Expr.evalListFuel (e.orderFuel+1+1) c r [e] = _
    rw [Expr.evalListFuel,value _ (by omega)]
    simp only [bindOk,Expr.evalListFuel]
  rw [Stmt.eval]; dsimp only; rw [list]
  change (match r.bindStorageRef c (.field "expiries") [.word id] with
    | .ok ref => (pure (.normal (r.declareLocal name ref)) : SolI Result)
    | .error err => pure (.reverted r err)) = _
  rw [ExpiryStorage.bindRecord _ _ _ fit fields]
end Inv08.Integral
