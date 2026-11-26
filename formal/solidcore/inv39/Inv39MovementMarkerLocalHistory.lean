import Inv39MovementMarkerLocal
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39

/-- Erasing physical marker-key certificates recovers the existing checked step. -/
theorem MarkerCompleted.checked {A s b ch post fin}
    (step : MarkerCompleted A s b ch post fin) : Completed A s b ch post fin := by
  cases step with
  | mint caller self addr v post out callerFit owner ownerFit stored valid seen valueFit actual =>
    exact .mint caller self addr v post out callerFit owner ownerFit stored valid seen valueFit actual
  | burn caller self addr v post out callerFit owner ownerFit stored valid seen valueFit actual =>
    exact .burn caller self addr v post out callerFit owner ownerFit stored valid seen valueFit actual
  | transfer src dst v self post out sv dv S D valueFit actual =>
    exact .transfer src dst v self post out sv dv S D valueFit actual
  | transferFrom src dst caller self v post out sx dy cv valueFit X Y typed disjoint actual key =>
    exact .transferFrom src dst caller self v post out sx dy cv valueFit X Y typed disjoint actual
  | approve caller self spender v post out cw sw vf separate actual key =>
    exact .approve caller self spender v post out cw sw vf separate actual
  | cancelAuthorization c o nonce v rr ss post out wf tf noValue disjoint actual key =>
    exact .cancelAuthorization c o nonce v rr ss post out wf tf noValue disjoint actual
  | permit c o sp v deadline vv rr ss post out ow sw vf df byte wf tf noValue fields events nonce allowance actual nonceKey allowanceKey =>
    exact .permit c o sp v deadline vv rr ss post out ow sw vf df byte wf tf noValue fields events nonce allowance actual
  | signedTransfer receive_ c p post out widths wf tf noValue S D flag fields events actual key =>
    exact .signedTransfer receive_ c p post out widths wf tf noValue S D flag fields events actual

/-- A refinement of the existing checked history with only the actual call's
auxiliary write keys separated from slot 7. No intermediate marker, trace or
step postcondition is a constructor premise. -/
inductive MarkerCheckedHistory (A : Nat → Prop) : State → Balances → List Change → State → Balances → Prop where
  | nil (s b) : MarkerCheckedHistory A s b [] s b
  | cons {s t post b mid fin ch tail} : MarkerCompleted A s b ch t mid →
      MarkerCheckedHistory A t mid tail post fin → MarkerCheckedHistory A s b (ch::tail) post fin

theorem MarkerCheckedHistory.checked {A s b changes post fin}
    (history : MarkerCheckedHistory A s b changes post fin) : History A s b changes post fin := by
  induction history with
  | nil => exact .nil _ _
  | cons step tail ih => exact .cons step.checked ih

theorem localCheckedHistoryMarker {A : Nat → Prop} {s post : State} {b fin : Balances}
    {changes : List Change} (history : MarkerCheckedHistory A s b changes post fin)
    (sep : SlotSeparation A) (book : Books A s b)
    (solvent : total b≤s.loadSlot theoretical.slot) (fit : s.loadSlot theoretical.slot<R)
    (marker : BalanceApart A) : post.loadSlot 7=s.loadSlot 7 := by
  induction history with
  | nil => rfl
  | @cons s t post b mid fin ch rest step tail ih =>
    obtain ⟨books,applied,bound,same⟩ := markerCompletedAccounts step sep book solvent fit marker
    have pre : (observed s).circulating≤(observed s).theoretical := by
      simpa only [observed,book.issued] using solvent
    have budget := (accountingStep _ 0 _ _ _
      (show (observed s).theoretical+0=((observed s).theoretical-(observed s).circulating)+(observed s).circulating from by omega)
      pre applied).2
    exact (ih books (by simpa only [observed,books.issued] using budget) bound).trans same

theorem localCheckedHistoryRepeatExcluded {A : Nat → Prop} {s post : State} {b fin : Balances}
    {changes : List Change} (history : MarkerCheckedHistory A s b changes post fin)
    (sep : SlotSeparation A) (book : Books A s b)
    (solvent : total b≤s.loadSlot theoretical.slot) (fit : s.loadSlot theoretical.slot<R)
    (marker : BalanceApart A) (initialized : Shared.norm (s.loadSlot 7)≠0)
    (next : State) (caller self uid cap rep : Nat) (out : List Source.Value) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext caller self) post [.word uid,.word cap,.word rep]≠some (.returned next out) := by
  apply Init.Repeat.publicExclusion
  rwa [localCheckedHistoryMarker history sep book solvent fit marker]
end Inv39
