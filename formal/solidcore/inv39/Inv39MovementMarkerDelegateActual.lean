import Inv39MovementMarkerDelegate
import Inv39DelegateSuccess
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
theorem actualTransferFromMarker (s post : State) (A : Nat → Prop) (b : Balances) (src dst caller self v : Nat) (out : List Source.Value)
    (xw : src<2^160) (yw : dst<2^160) (sw : caller<2^160) (vf : v<R) (X : A src) (Y : A dst)
    (oldFit : s.loadSlot (slot src caller)<R) (separate : s.loadSlot (slot src caller)<R-1 → Separate A src caller)
    (sep : SlotSeparation A) (book : Books A s b) (fit : total b<R)
    (marker : BalanceApart A)
    (allowMarker : s.loadSlot (slot src caller)<R-1 → Init.MarkerHistory.Apart (slot src caller))
    (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom") (Child.callContext caller self) s [.word src,.word dst,.word v]=some (.returned post out)) :
    v≤balance src b ∧ Books A post (move src dst v b) ∧ post.loadSlot theoretical.slot=s.loadSlot theoretical.slot ∧ post.loadSlot 7=s.loadSlot 7 := by
  let old := s.loadSlot (slot src caller)
  have succeeds : ∀ e, ¬Failure s src dst caller old v e := by
    intro e fail
    have denied := publicDenied s src dst caller self old v xw yw sw vf rfl oldFit _ fail
    rw [actual] at denied; cases denied
  have allowed (bounded : old<R-1) : v≤old := by
    by_contra! low
    exact succeeds _ (.charge bounded (.short low))
  have both (bounded : old<R-1) : src≠0 ∧ caller≠0 := by
    have bad : ¬(src=0 ∨ caller=0) := fun z => succeeds _ (.charge bounded (.zero (allowed bounded) z))
    exact ⟨fun z => bad (.inl z),fun z => bad (.inr z)⟩
  have moveOk : ∀ err, ¬Transfer.Rejection (afterSpend s src caller old v) src dst v err := by
    intro err rejected
    exact succeeds _ (.move allowed (fun b => (both b).1) (fun b => (both b).2) rejected)
  have xn : src≠0 := fun z => moveOk _ (.zero (.inl z))
  have yn : dst≠0 := fun z => moveOk _ (.zero (.inr ⟨rfl,z⟩))
  have same := framed s A b src caller old v book separate
  have enough : v≤balance src b := by
    by_contra! low
    exact moveOk _ (.low xn yn (by simpa only [same.1.balances src X] using low))
  obtain ⟨q,success,books,ceiling,mark⟩ := publicTransferFromMarker s A b src dst v caller self old xw yw sw xn yn (fun b => (both b).2) X Y rfl oldFit allowed separate sep book enough fit marker allowMarker
  rw [actual] at success; cases success
  exact ⟨enough,books,ceiling,mark⟩
end Inv39.Allowance
