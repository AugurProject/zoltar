import Inv39MovementMarkerBurnBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Child
theorem publicBurnMarker (s : State) (A : Nat → Prop) (b : Balances) (sender self addr val : Nat)
    (senderFit : sender<R) (authorized : s.immutable? "zoltar"=some (.word sender))
    (valid : addr<2^160) (nonzero : addr≠0) (seen : A addr) (sep : SlotSeparation A) (book : Books A s b)
    (enough : val≤balance addr b) (solvent : total b ≤ s.loadSlot theoretical.slot) (fit : s.loadSlot theoretical.slot<R) (marker : BalanceApart A) :
    ∃ post, TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "burn") (callContext sender self) s [.word addr,.word val] =
        some (.returned post []) ∧ Books A post (setBalance addr (balance addr b-val) b) ∧
        post.loadSlot theoretical.slot = s.loadSlot theoretical.slot-val ∧ post.loadSlot 7=s.loadSlot 7 := by
  let c := callContext sender self
  let base := CheckedWordCall.initial c s
  let start := (enter base addr val).pushScope.pushScope.pushScope
  have bounds := lt_of_le_of_lt (le_trans (le_trans enough (balanceLE addr b)) solvent) fit
  obtain ⟨out,ev,_,books,observed,mark⟩ := burnEffectsMarker 49980 c start A b addr val rfl rfl valid nonzero seen sep
    (Books.ofStorageEq (s:=s) rfl book) enough solvent fit marker rfl rfl
  have run := wrapAuthorized .burn 49995 model.core.table c base addr val bounds senderFit rfl authorized out ev
  exact ⟨_,dispatch .burn _ _ _ _ _ _ run,Books.ofStorageEq (s:=out.state) rfl books,observed,mark⟩
end Inv39.Child
