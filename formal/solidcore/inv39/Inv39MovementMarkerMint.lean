import Inv39MovementMarkerCore
import Inv39PublicMint
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Child
theorem mintEffectsMarker (n : Nat) (c : Context) (r : Runtime) (A : Nat → Prop) (b : Balances) (addr val : Nat)
    (account : r.lookupLocal? "account"=some (.word addr)) (qty : r.lookupLocal? "valueAttoRep"=some (.word val))
    (valid : addr<2^160) (nonzero : addr≠0) (seen : A addr) (sep : SlotSeparation A) (book : Books A r.state b)
    (allowed : total b + val ≤ r.state.loadSlot theoretical.slot) (fit : r.state.loadSlot theoretical.slot<R)
    (marker : BalanceApart A)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+16) model.core.table c r (effects .mint).value = pure (.normal next) ∧
      Books A next.state (setBalance addr (balance addr b+val) b) ∧
      next.state.loadSlot theoretical.slot=r.state.loadSlot theoretical.slot ∧ next.state.loadSlot 7=r.state.loadSlot 7 := by
  let t := model.core.table
  let inside := r.pushScope
  have fits := lt_of_le_of_lt allowed fit
  have valWord : val<R := by omega
  have check := guardRun (n+8) c inside (total b) val _ qty book.issued rfl fit allowed fields
  have bs := mintedBooks A r.state b addr val sep seen nonzero book fits
  obtain ⟨deb,run,locals,storage⟩ := goRun .mint n c inside addr val account qty valid nonzero valWord bs.1 bs.2.1 fields events
  have debBook := bs.2.2.1.ofStorageEq storage
  have debMarker : deb.state.loadSlot 7=r.state.loadSlot 7 := by
    have frame := movementFrame r.state (Motion.fromAddress (motion .mint) addr)
      (Motion.toAddress (motion .mint) addr 0) val
    have same := frame (Or.inl rfl)
      (Or.inr (marker addr seen))
    simpa only [State.loadSlot,storage] using same

  have sameTh : deb.state.loadSlot theoretical.slot = r.state.loadSlot theoretical.slot := by
    simpa only [State.loadSlot,storage] using bs.2.2.2
  have debLook (s : String) : deb.lookupLocal? s = inside.lookupLocal? s := by simp [Runtime.lookupLocal?,locals]
  have addrWord : addr<R := lt_trans valid (by decide)
  have abi : abiAddressFits addr := by simpa [abiAddressFits,show Shared.norm addr=addr from Nat.mod_eq_of_lt addrWord] using valid
  obtain ⟨logged,emit,_,stored⟩ := SupplyEvents.run .mint (n+14) t c deb addr val ((debLook _).trans account)
    ((debLook _).trans qty) abi fields events
  refine ⟨logged.popScope,?_,debBook.ofStorageEq stored,?_,?_⟩
  · apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ check).trans ((seqStep _ _ _ _ _ _ _ run).trans ((seqStep _ _ _ _ _ _ [] emit).trans
      (show Stmt.evalList (n+15) t c logged []=pure (.normal logged) by rw [Stmt.evalList])))
  · simpa only [State.loadSlot,Runtime.popScope,stored] using sameTh
  · simpa only [State.loadSlot,Runtime.popScope,stored] using debMarker
theorem publicMintMarker (s : State) (A : Nat → Prop) (b : Balances) (sender self addr val : Nat)
    (senderFit : sender<R) (authorized : s.immutable? "zoltar"=some (.word sender))
    (valid : addr<2^160) (nonzero : addr≠0) (seen : A addr) (sep : SlotSeparation A) (book : Books A s b)
    (allowed : total b + val ≤ s.loadSlot theoretical.slot) (fit : s.loadSlot theoretical.slot<R) (marker : BalanceApart A) :
    ∃ post, TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "mint") (callContext sender self) s [.word addr,.word val] =
        some (.returned post []) ∧ Books A post (setBalance addr (balance addr b+val) b) ∧
        post.loadSlot theoretical.slot = s.loadSlot theoretical.slot ∧ post.loadSlot 7=s.loadSlot 7 := by
  let c := callContext sender self
  let base := CheckedWordCall.initial c s
  let start := (enter base addr val).pushScope.pushScope.pushScope
  have bounds : val<R := lt_of_le_of_lt (le_trans (Nat.le_add_left _ _) allowed) fit
  obtain ⟨out,ev,books,observed,mark⟩ := mintEffectsMarker 49980 c start A b addr val rfl rfl valid nonzero seen sep
    (Books.ofStorageEq (s:=s) rfl book) allowed fit marker rfl rfl
  have run := wrapAuthorized .mint 49995 model.core.table c base addr val bounds senderFit rfl authorized out ev
  exact ⟨_,dispatch .mint _ _ _ _ _ _ run,Books.ofStorageEq (s:=out.state) rfl books,observed,mark⟩
end Inv39.Child
