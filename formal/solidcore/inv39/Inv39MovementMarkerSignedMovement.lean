import Inv39MovementMarkerCore
import Inv39SignedMovement
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Auth
structure MovedMarker (A : Nat→Prop) (b : Balances) (x y v ceiling marker : Nat) (s : State) : Prop where
  funded : v≤balance x b
  books : Books A s (move x y v b)
  cap : s.loadSlot theoretical.slot=ceiling
  marker : s.loadSlot 7=marker
theorem movedMarker (n : Nat) (c : Context) (r : Runtime) (A : Nat→Prop) (b : Balances) (x y v : Nat)
    (X : r.lookupLocal? "from"=some (.word x)) (Y : r.lookupLocal? "to"=some (.word y)) (V : r.lookupLocal? "value"=some (.word v))
    (xw : x<2^160) (yw : y<2^160) (vf : v<R) (S : A x) (D : A y) (sep : SlotSeparation A) (book : Books A r.state b) (fit : total b<R)
    (marker : BalanceApart A)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Fold.Ensures (Stmt.eval (n+15) model.core.table c r motionTail.value) (normal (fun q=>MovedMarker A b x y v (r.state.loadSlot theoretical.slot) (r.state.loadSlot 7) q.state)) := by
  let ready := Allowance.three r x y v
  let key := Motion.key .transfer
  let call := Source.Stmt.internalCall [] key [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"]
  have yTemp : (r.pushScope.declareLocal "_ic_arg_0" (.word x)).lookupLocal? "to"=some (.word y) := Y
  have failed (next : Runtime) (e : RevertData) (no : Stmt.eval (n+13) model.core.table c ready call=pure (.reverted next e)) :
      Fold.Ensures (Stmt.eval (n+15) model.core.table c r motionTail.value)
        (normal (fun q=>MovedMarker A b x y v (r.state.loadSlot theoretical.slot) (r.state.loadSlot 7) q.state)) := by
    change Fold.Ensures (Stmt.eval _ _ _ _ (Allowance.prep "from" "to" key).value) _
    rw [Allowance.prepDenied (n+13) c r _ _ _ x y v X yTemp V vf next e no]; exact Fold.pureValue (Result.reverted _ _) _ trivial
  by_cases bad : Motion.invalidEndpoint .transfer x y
  · obtain ⟨q,err⟩ := Motion.zeroCall n c ready .transfer x y v "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" rfl (fun _=>rfl) rfl xw yw vf bad
    exact failed q _ err
  · have xn : x≠0 := fun zx=>bad (.inl zx)
    have yn : y≠0 := fun zy=>bad (.inr ⟨rfl,zy⟩)
    by_cases enough : v≤balance x b
    · obtain ⟨q,ok,_,books,cap,mark⟩ := transferCallMarker n c ready A b x y v "_ic_arg_0" "_ic_arg_1" "_ic_arg_2"
        rfl rfl rfl xw yw xn yn S D sep book enough fit marker fields events
      change Fold.Ensures (Stmt.eval _ _ _ _ (Allowance.prep "from" "to" key).value) _
      rw [Allowance.prepOK (n+13) c r _ _ _ x y v X yTemp V vf q ok]
      exact Fold.pureValue (Result.normal q.popScope) (normal (fun q=>MovedMarker A b x y v (r.state.loadSlot theoretical.slot) (r.state.loadSlot 7) q.state)) ⟨enough,books,cap,mark⟩
    · have low : ready.state.loadSlot (balanceSlot x)<v := by simpa only [show ready.state=r.state from rfl,book.balances x S] using Nat.lt_of_not_ge enough
      obtain ⟨q,err⟩ := Motion.rejectedCall n c ready .transfer x y v "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" rfl (fun _=>rfl) rfl xw yw vf xn (fun _=>yn) (by decide) low fields
      exact failed q _ err
end Inv39.Auth
