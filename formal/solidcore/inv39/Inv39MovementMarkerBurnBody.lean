import Inv39MovementMarkerCore
import Inv39BurnEffect
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Child
theorem burnEffectsMarker (n : Nat) (c : Context) (r : Runtime) (A : Nat → Prop) (b : Balances) (addr val : Nat)
    (account : r.lookupLocal? "account"=some (.word addr)) (qty : r.lookupLocal? "valueAttoRep"=some (.word val))
    (valid : addr<2^160) (nonzero : addr≠0) (seen : A addr) (sep : SlotSeparation A) (book : Books A r.state b)
    (enough : val≤balance addr b) (solvent : total b ≤ r.state.loadSlot theoretical.slot) (fit : r.state.loadSlot theoretical.slot<R)
    (marker : BalanceApart A)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+16) model.core.table c r (effects .burn).value = pure (.normal next) ∧
      next.locals=r.locals ∧ Books A next.state (setBalance addr (balance addr b-val) b) ∧
      next.state.loadSlot theoretical.slot=r.state.loadSlot theoretical.slot-val ∧ next.state.loadSlot 7=r.state.loadSlot 7 := by
  let t := model.core.table
  let inside := r.pushScope
  let remaining := setBalance addr (balance addr b-val) b
  have bound := le_trans enough (balanceLE addr b)
  have valWord := lt_of_le_of_lt (le_trans bound solvent) fit
  have bs := burnedBooks A r.state b addr val sep seen nonzero book enough (lt_of_le_of_lt solvent fit)
  obtain ⟨deb,run,locals,storage⟩ := goRun .burn n c inside addr val account qty valid nonzero valWord bs.1 bs.2.1 fields events
  have debBook := bs.2.2.1.ofStorageEq storage
  have debMarker : deb.state.loadSlot 7=r.state.loadSlot 7 := by
    have same := movementFrame r.state addr 0 val (Or.inr (marker addr seen)) (Or.inl rfl)
    simpa only [State.loadSlot,storage,Motion.fromAddress,Motion.toAddress,motion] using same

  have sameTh : deb.state.loadSlot theoretical.slot = r.state.loadSlot theoretical.slot := by
    simpa only [State.loadSlot,storage] using bs.2.2.2
  have debLook (s : String) : deb.lookupLocal? s = inside.lookupLocal? s := by simp [Runtime.lookupLocal?,locals]
  let th := r.state.loadSlot theoretical.slot-val
  let charged := {deb with state:=deb.state.storeSlot theoretical.slot th}
  have execCharge : Stmt.eval (n+15) t c deb cost.value = pure (.normal charged) := by
    have h := decrementStatement c deb theoretical t (n+14) val "valueAttoRep" Inv39.layout.2 ((debLook _).trans qty)
      (show val≤WordField.stored deb.state theoretical by simpa only [WordField.stored,sameTh] using le_trans bound solvent)
      (show WordField.stored deb.state theoretical<R by simpa only [WordField.stored,sameTh] using fit) fields
    simpa only [WordField.stored,sameTh] using h
  have ready : Books A charged.state remaining := by
    refine ⟨writeOutsideBalances _ _ _ _ _ _ debBook.balances (fun a ha => (sep.theoretical a ha).symm),?_⟩
    exact (loadUnchanged _ _ _ _ (by decide : Shared.norm theoretical.slot ≠ Shared.norm circulating.slot)).trans debBook.issued
  have addrWord : addr<R := lt_trans valid (by decide)
  have abi : abiAddressFits addr := by simpa [abiAddressFits,show Shared.norm addr=addr from Nat.mod_eq_of_lt addrWord] using valid
  obtain ⟨logged,emit,emLoc,emStore⟩ := SupplyEvents.run .burn (n+14) t c charged addr val ((debLook _).trans account)
    ((debLook _).trans qty) abi fields events
  refine ⟨logged.popScope,?_,?_,ready.ofStorageEq emStore,?_,?_⟩
  · apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ run).trans ((seqStep _ _ _ _ _ _ _ execCharge).trans ((seqStep _ _ _ _ _ _ [] emit).trans
      (show Stmt.evalList (n+15) t c logged []=pure (.normal logged) by rw [Stmt.evalList])))
  · change logged.locals.drop 1=r.locals
    rw [emLoc]; change deb.locals.drop 1 = _; rw [locals]; rfl
  · change logged.state.loadSlot theoretical.slot=th
    have last : charged.state.loadSlot theoretical.slot=th := loadChanged _ _ _ (lt_of_le_of_lt (Nat.sub_le _ _) fit)
    simpa only [State.loadSlot,emStore] using last
  · have same := Init.MarkerHistory.store deb.state theoretical.slot th (by unfold Init.MarkerHistory.Apart; decide)
    simpa only [State.loadSlot,Runtime.popScope,emStore] using same.trans debMarker

end Inv39.Child
