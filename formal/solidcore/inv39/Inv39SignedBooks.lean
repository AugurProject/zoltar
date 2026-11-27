import Inv39PublicCancel
import Inv39PublicPermit
import Inv39DelegatedBooks
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
structure Separate (A : Nat→Prop) (i : Nat) : Prop where
  balances : ∀ a,A a→Shared.norm i≠Shared.norm (balanceSlot a)
  issued : Shared.norm i≠Shared.norm circulating.slot
  ceiling : Shared.norm i≠Shared.norm theoretical.slot
theorem outside (s : State) (A : Nat→Prop) (b : Balances) (i val : Nat) (sep : Separate A i) (book : Books A s b) :
    Books A (s.storeSlot i val) b ∧ (s.storeSlot i val).loadSlot theoretical.slot=s.loadSlot theoretical.slot :=
  ⟨⟨writeOutsideBalances _ _ _ _ _ _ book.balances sep.balances,(loadUnchanged _ _ _ _ sep.issued).trans book.issued⟩,loadUnchanged _ _ _ _ sep.ceiling⟩
theorem booksEqual {s q : State} {A : Nat→Prop} {b : Balances} (same : ∀k,q.loadSlot k=s.loadSlot k) (book : Books A s b) : Books A q b :=
  ⟨fun a ha=>(same _).trans (book.balances _ ha),(same _).trans book.issued⟩
theorem cancelledBooks (c : Context) (s q : State) (A : Nat→Prop) (b : Balances) (o nonce v rr ss : Nat) (out : List Source.Value)
    (book : Books A s b) (sep : Separate A (flagSlot o nonce)) (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (fee : c.value=0)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "cancelAuthorization") c s (cancelArgs o nonce v rr ss)=some (.returned q out)) :
    Books A q b ∧ q.loadSlot theoretical.slot=s.loadSlot theoretical.slot := by
  have actual := actualCancellation c s q o nonce v rr ss out wf tf fee run
  have ⟨ledger,cap⟩ := outside s A b _ 1 sep book
  exact ⟨booksEqual actual ledger,(actual _).trans cap⟩
theorem permittedBooks (c : Context) (s q : State) (A : Nat→Prop) (b : Balances) (o sp v deadline vv rr ss : Nat) (out : List Source.Value)
    (book : Books A s b) (sepNonce : Separate A (nonceSlot o)) (sepAllowance : Allowance.Separate A o sp)
    (ow : o<2^160) (sw : sp<2^160) (vf : v<R) (df : deadline<R) (byte : vv<256)
    (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value=0)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "permit") c s (permitArgs o sp v deadline vv rr ss)=some (.returned q out)) :
    Books A q b ∧ q.loadSlot theoretical.slot=s.loadSlot theoretical.slot := by
  obtain ⟨nv,actual⟩ := actualPermit c s q o sp v deadline vv rr ss out ow sw vf df byte wf tf noValue fields events run
  have ⟨inc,ceiling⟩ := outside s A b _ nv sepNonce book
  have ⟨grant,cap⟩ := outside _ A b (Allowance.slot o sp) v ⟨sepAllowance.balances,sepAllowance.issued,sepAllowance.ceiling⟩ inc
  exact ⟨booksEqual actual grant,(actual _).trans (cap.trans ceiling)⟩
end Inv39.Auth
