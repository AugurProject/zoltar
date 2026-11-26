import Inv39MarkerHistory
import Inv39TransferCore
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39
/-- Physical normalized-key separation only; no hash injectivity is assumed. -/
def BalanceApart (A : Nat → Prop) := ∀ a, A a → Init.MarkerHistory.Apart (balanceSlot a)
theorem movementFrame (s : State) (src dst v : Nat)
    (sx : src=0 ∨ Init.MarkerHistory.Apart (balanceSlot src))
    (dy : dst=0 ∨ Init.MarkerHistory.Apart (balanceSlot dst)) :
    (ERC20.afterTo (ERC20.afterFrom s src v) dst v).loadSlot 7=s.loadSlot 7 := by
  have first : (ERC20.afterFrom s src v).loadSlot 7=s.loadSlot 7 := by
    unfold ERC20.afterFrom
    split
    · exact Init.MarkerHistory.store _ _ _ (by unfold Init.MarkerHistory.Apart; decide)
    · exact Init.MarkerHistory.store _ _ _ (sx.resolve_left ‹src≠0›)
  have last : (ERC20.afterTo (ERC20.afterFrom s src v) dst v).loadSlot 7=
      (ERC20.afterFrom s src v).loadSlot 7 := by
    unfold ERC20.afterTo
    split
    · exact Init.MarkerHistory.store _ _ _ (by unfold Init.MarkerHistory.Apart; decide)
    · exact Init.MarkerHistory.store _ _ _ (dy.resolve_left ‹dst≠0›)
  exact last.trans first
theorem transferCallMarker (n : Nat) (c : Context) (r : Runtime) (A : Nat → Prop) (b : Balances) (src dst val : Nat)
    (x y z : String) (X : r.lookupLocal? x=some (.word src)) (Y : r.lookupLocal? y=some (.word dst)) (Z : r.lookupLocal? z=some (.word val))
    (srcFit : src<2^160) (dstFit : dst<2^160) (sn : src≠0) (dn : dst≠0)
    (S : A src) (D : A dst) (sep : SlotSeparation A) (book : Books A r.state b)
    (enough : val≤balance src b) (fit : total b<R)
    (marker : BalanceApart A)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+13) model.core.table c r (.internalCall [] (Motion.key .transfer) (Motion.exprs .transfer x y z)) =
        pure (.normal next) ∧ next.locals=r.locals ∧ Books A next.state (move src dst val b) ∧
        next.state.loadSlot theoretical.slot=r.state.loadSlot theoretical.slot ∧
        next.state.loadSlot 7=r.state.loadSlot 7 := by
  have bs := transferredBooks A r.state b src dst val sep S D sn dn book enough fit
  have valFit := lt_of_le_of_lt (le_trans enough (balanceLE src b)) fit
  obtain ⟨next,ev,locals,eqn⟩ := Motion.call n c r .transfer src dst val x y z X (fun _ => Y) Z srcFit dstFit valFit sn
    (fun _ => dn) bs.1 bs.2.1 fields events
  refine ⟨next,ev,locals,bs.2.2.1.ofStorageEq eqn,by simpa only [State.loadSlot,eqn] using bs.2.2.2,?_⟩
  simpa only [State.loadSlot,eqn,Motion.fromAddress,Motion.toAddress] using
    movementFrame r.state src dst val (Or.inr (marker src S)) (Or.inr (marker dst D))
end Inv39
