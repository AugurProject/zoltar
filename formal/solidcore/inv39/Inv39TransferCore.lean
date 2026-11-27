import Inv39PublicMint
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
/-- Every ERC20 movement between two existing addresses preserves both supply counters.
The theorem uses the child contract's actual inherited transfer function table. -/
theorem transferCall (n : Nat) (c : Context) (r : Runtime) (A : Nat → Prop) (b : Balances) (src dst val : Nat)
    (x y z : String) (X : r.lookupLocal? x=some (.word src)) (Y : r.lookupLocal? y=some (.word dst)) (Z : r.lookupLocal? z=some (.word val))
    (srcFit : src<2^160) (dstFit : dst<2^160) (sn : src≠0) (dn : dst≠0)
    (S : A src) (D : A dst) (sep : SlotSeparation A) (book : Books A r.state b)
    (enough : val≤balance src b) (fit : total b<R)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+13) model.core.table c r (.internalCall [] (Motion.key .transfer) (Motion.exprs .transfer x y z)) =
        pure (.normal next) ∧ next.locals=r.locals ∧ Books A next.state (move src dst val b) ∧
        next.state.loadSlot theoretical.slot=r.state.loadSlot theoretical.slot := by
  have bs := transferredBooks A r.state b src dst val sep S D sn dn book enough fit
  have valFit := lt_of_le_of_lt (le_trans enough (balanceLE src b)) fit
  obtain ⟨next,ev,locals,eqn⟩ := Motion.call n c r .transfer src dst val x y z X (fun _ => Y) Z srcFit dstFit valFit sn
    (fun _ => dn) bs.1 bs.2.1 fields events
  exact ⟨next,ev,locals,bs.2.2.1.ofStorageEq eqn,by simpa only [State.loadSlot,eqn] using bs.2.2.2⟩
end Inv39
