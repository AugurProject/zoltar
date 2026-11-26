import Inv39UpdateCall
import Inv39SupplyDelta
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
/-- Keccak isolation for account keys appearing in this trace, including both supply counters. -/
structure SlotSeparation (A : Nat → Prop) : Prop where
  accounts : ∀ x y, A x → A y → Shared.norm (balanceSlot x)=Shared.norm (balanceSlot y) → x=y
  circulating : ∀ x, A x → Shared.norm (balanceSlot x) ≠ Shared.norm Inv39.circulating.slot
  theoretical : ∀ x, A x → Shared.norm (balanceSlot x) ≠ Shared.norm Inv39.theoretical.slot
/-- The balance witness records precisely the circulating REP on all participating accounts. -/
structure Books (A : Nat → Prop) (s : State) (b : Balances) : Prop where
  balances : Represents A balanceSlot s b
  issued : s.loadSlot circulating.slot = total b
theorem Books.ofStorageEq {A : Nat → Prop} {s s' : State} {b : Balances} (eq : s'.storage = s.storage)
    (h : Books A s b) : Books A s' b := by
  have same (i : Nat) : s'.loadSlot i = s.loadSlot i := by simp [State.loadSlot,eq]
  exact ⟨fun a ha => (same _).trans (h.balances a ha),(same _).trans h.issued⟩
private theorem sameCounter (s : State) (a v : Nat) (distinct : Shared.norm (balanceSlot a) ≠ Shared.norm circulating.slot) :
    (s.storeSlot (balanceSlot a) v).loadSlot circulating.slot = s.loadSlot circulating.slot :=
  loadUnchanged _ _ _ _ distinct
theorem mintedBooks (A : Nat → Prop) (s : State) (b : Balances) (addr qty : Nat)
    (sep : SlotSeparation A) (seen : A addr) (addrNe : addr ≠ 0)
    (start : Books A s b) (fits : total b+qty<R) :
    let debit := ERC20.afterFrom s 0 qty
    let post := ERC20.afterTo debit addr qty
    ERC20.fromBounds s 0 qty ∧ ERC20.toBounds debit addr qty ∧
    Books A post (setBalance addr (balance addr b+qty) b) ∧
    post.loadSlot theoretical.slot = s.loadSlot theoretical.slot := by
  let mid := s.storeSlot circulating.slot (total b+qty)
  let pay := balance addr b+qty
  have atMid : Represents A balanceSlot mid b :=
    writeOutsideBalances _ _ _ _ _ _ start.balances (fun a ha => (sep.circulating a ha).symm)
  have fitsPay : pay<R := lt_of_le_of_lt (Nat.add_le_add_right (balanceLE addr b) qty) fits
  have distinct : Shared.norm circulating.slot ≠ Shared.norm theoretical.slot := by decide
  simp only [ERC20.afterFrom,ERC20.afterTo,ERC20.fromBounds,ERC20.toBounds,addrNe,if_false,if_true,start.issued]
  change total b+qty<R ∧ mid.loadSlot (balanceSlot addr)+qty<R ∧ _ ∧ _
  rw [atMid addr seen]
  refine ⟨fits,fitsPay,⟨setRepresents A balanceSlot mid b addr pay seen fitsPay sep.accounts atMid,?_⟩,?_⟩
  · rw [sameCounter _ _ _ (sep.circulating addr seen),mint]
    exact loadChanged _ _ _ fits
  · rw [loadUnchanged _ _ _ _ (sep.theoretical addr seen)]
    exact loadUnchanged _ _ _ _ distinct
theorem burnedBooks (A : Nat → Prop) (s : State) (b : Balances) (addr qty : Nat)
    (sep : SlotSeparation A) (seen : A addr) (addrNe : addr ≠ 0)
    (start : Books A s b) (enough : qty ≤ balance addr b) (fits : total b < R) :
    let mid := ERC20.afterFrom s addr qty
    let post := ERC20.afterTo mid 0 qty
    ERC20.fromBounds s addr qty ∧ ERC20.toBounds mid 0 qty ∧
    Books A post (setBalance addr (balance addr b-qty) b) ∧
    post.loadSlot theoretical.slot = s.loadSlot theoretical.slot := by
  let left := balance addr b-qty
  let bal := setBalance addr left b
  let mid := s.storeSlot (balanceSlot addr) left
  have fitsOld := lt_of_le_of_lt (balanceLE addr b) fits
  have fitsLeft : left < R := lt_of_le_of_lt (Nat.sub_le _ _) fitsOld
  have fitsSupply := lt_of_le_of_lt (Nat.sub_le (total b) qty) fits
  have atMid : Represents A balanceSlot mid bal := setRepresents _ _ _ _ _ _ seen fitsLeft sep.accounts start.balances
  have circMid : mid.loadSlot circulating.slot = total b := (sameCounter _ _ _ (sep.circulating addr seen)).trans start.issued
  have distinct : Shared.norm circulating.slot ≠ Shared.norm theoretical.slot := by decide
  simp only [ERC20.afterFrom,ERC20.afterTo,ERC20.fromBounds,ERC20.toBounds,addrNe,if_false,if_true,start.balances addr seen]
  change (_ ∧ _) ∧ (_ ≤ mid.loadSlot circulating.slot ∧ _) ∧ _ ∧ _
  rw [circMid]
  refine ⟨⟨enough,fitsOld⟩,⟨le_trans enough (balanceLE addr b),fits⟩,⟨?_,?_⟩,?_⟩
  · exact writeOutsideBalances _ _ _ _ _ _ atMid (fun a ha => (sep.circulating a ha).symm)
  · rw [burn _ _ _ enough]
    exact loadChanged _ _ _ fitsSupply
  · rw [loadUnchanged _ _ _ _ distinct]
    exact loadUnchanged _ _ _ _ (sep.theoretical addr seen)
theorem transferredBooks (A : Nat → Prop) (s : State) (b : Balances) (src dst qty : Nat)
    (sep : SlotSeparation A) (S : A src) (D : A dst) (sn : src ≠ 0) (dn : dst ≠ 0)
    (start : Books A s b) (enough : qty ≤ balance src b) (fits : total b < R) :
    let mid := ERC20.afterFrom s src qty
    let post := ERC20.afterTo mid dst qty
    ERC20.fromBounds s src qty ∧ ERC20.toBounds mid dst qty ∧
    Books A post (move src dst qty b) ∧ post.loadSlot theoretical.slot = s.loadSlot theoretical.slot := by
  let left := balance src b-qty
  let bal := setBalance src left b
  let mid := s.storeSlot (balanceSlot src) left
  have old := lt_of_le_of_lt (balanceLE src b) fits
  have midRep : Represents A balanceSlot mid bal :=
    setRepresents _ _ _ _ _ _ S (lt_of_le_of_lt (Nat.sub_le _ _) old) sep.accounts start.balances
  have supply : total bal = total b - qty := burn _ _ _ enough
  have balBound := balanceLE dst bal
  have qbound := le_trans enough (balanceLE src b)
  have fitsDst : balance dst bal+qty < R := by omega
  simp only [ERC20.afterFrom,ERC20.afterTo,ERC20.fromBounds,ERC20.toBounds,sn,dn,if_false,start.balances src S]
  change (_ ∧ _) ∧ mid.loadSlot (balanceSlot dst)+qty<R ∧ _ ∧ _
  rw [midRep dst D]
  refine ⟨⟨enough,old⟩,fitsDst,⟨setRepresents _ _ _ _ _ _ D fitsDst sep.accounts midRep,?_⟩,?_⟩
  · rw [movePreserves _ _ _ _ enough,sameCounter _ _ _ (sep.circulating dst D)]
    exact (sameCounter _ _ _ (sep.circulating src S)).trans start.issued
  · rw [loadUnchanged _ _ _ _ (sep.theoretical dst D)]
    exact loadUnchanged _ _ _ _ (sep.theoretical src S)
end Inv39
