import Inv08AddStreamGuards
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv08.AddStream
def deferredSlot (eth : Bool) := if eth then 3 else 4
def deferredField (eth : Bool) : StorageField :=
  {name:=deferredName eth,slot:=deferredSlot eth,ty? := some .uint256,layout? := some (.scalar .uint256)}
private def matched (eth : Bool) : Option StorageField → Bool
  | some ⟨name,slot,some .uint256,some (.scalar .uint256),false,0,32,false⟩ => name==deferredName eth && slot==deferredSlot eth
  | _ => false
private theorem lookup (c : Context) (eth : Bool) (fields : c.storageFields=model.core.context.storageFields) :
    c.storageField? (deferredName eth)=some (deferredField eth) := by
  change c.storageFields.find? _ = _
  rw [fields]
  change model.core.context.storageField? (deferredName eth)=_
  have same := show matched eth (model.core.context.storageField? (deferredName eth)) by cases eth <;> native_decide
  generalize model.core.context.storageField? (deferredName eth)=field at *
  unfold matched at same
  split at same
  · simp only [Bool.and_eq_true,beq_iff_eq] at same
    obtain ⟨rfl,rfl⟩ := same; rfl
  · contradiction
theorem deferredRead (c : Context) (r : Runtime) (eth : Bool) (fields : c.storageFields=model.core.context.storageFields) :
    Inv40.Reads c r (.storageRead .ref (deferredName eth) []) (r.state.loadSlot (deferredSlot eth)) := by
  have read : r.loadStorageField c (deferredName eth) = .ok (.word (r.state.loadSlot (deferredSlot eth))) := by
    unfold Runtime.loadStorageField
    rw [lookup c eth fields]; rfl
  intro fuel enough
  cases fuel with
  | zero => simp [Expr.orderFuel] at enough
  | succ n =>
    rw [Expr.evalFuel]
    change (do let v ← liftM (r.loadStorageField c (deferredName eth)); pure (v,r)) = _
    rw [read]; rfl

theorem budgetValue (c : Context) (r : Runtime) (eth : Bool) (fields : c.storageFields=model.core.context.storageFields)
    (cap : stored r.state (outstandingField eth) + r.state.loadSlot (deferredSlot eth) < 2^128) :
    Inv40.Reads c r (budgetTest eth).value 1 := by
  let a := stored r.state (outstandingField eth)
  let b := r.state.loadSlot (deferredSlot eth)
  have total : a+b<R := lt_trans cap (by decide)
  have left := fieldRead c r _ fields (lt_of_le_of_lt (Nat.le_add_right _ _) total)
  have right := ReleaseQuote.readClean (deferredRead c r eth fields) (lt_of_le_of_lt (Nat.le_add_left _ _) total)
  have sum := Authority.double (ReleaseQuote.binary left right .add (by intro h; cases h) (by intro h; cases h)
    (Inv40.addWords _ a b total)) total
  have le : a+b≤2^128-1 := Nat.le_pred_of_lt cap
  have op : Source.BinaryOp.apply c.checked .le (.word (a+b)) (.word (2^128-1)) = .ok (.word 1) := by
    change Source.BinaryOp.apply false .le _ _ = _
    rw [Inv32WideGuards.leWord (a+b) (2^128-1) total (by decide), if_pos le]
  exact ReleaseQuote.binary sum (maxReads c r 128 (by decide)) .le (by intro h; cases h) (by intro h; cases h) op

theorem budgetCheck (n : Nat) (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields)
    (eth : stored r.state .ethOut + r.state.loadSlot 3 < 2^128) (rep : stored r.state .repOut + r.state.loadSlot 4 < 2^128) :
    budget.value.eval (n+6) model.core.table c r = pure (.normal r) := by
  obtain ⟨fn,found,ps,rs,bd⟩ := budgetLink
  let empty := {r.pushScope with locals:=[]}
  let src := empty.withFrame []
  let rt := src.pushScope.pushScope
  let ctx := {c with checked:=true}
  have condition := Authority.andTrue (budgetValue ctx rt true fields eth) (budgetValue ctx rt false fields rep)
  have guard := requireHolds n ctx rt _ "Fee budget exceeds token domain" condition
  have first := Inv32Blocks.one (n+1) model.core.table ctx src.pushScope rt _ guard
  have second := Inv32Blocks.one (n+2) model.core.table ctx src src.pushScope _ first
  have ev : Stmt.eval (n+3) model.core.table ctx src fn.body = pure (.normal src) := by rw [bd]; exact second
  have enter : internalCallEnter? fn [] r.pushScope = some (src,r.pushScope.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgsRef?,src,empty,Runtime.withFrame]
  have call := Inv32Internal.call (n+3) _ c r.pushScope r.pushScope src budgetKey fn [] [] [] _ _ (by rfl) found enter ev
  have trans : Stmt.eval (n+4) model.core.table c r.pushScope (.internalCall [] budgetKey []) = pure (.normal r.pushScope) := by
    rw [call,internalCallFinish,rs]; rfl
  exact Inv32Blocks.one _ _ _ _ r.pushScope _ (Inv32Internal.capture _ _ _ _ _ [] _ trans)
end Inv08.AddStream
