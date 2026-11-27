import Inv39PublicReads
import Inv39FullPublicInitialized
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.FullPublic
/-- Calls before the first successful initialization. Failed initialization is a
reverted call; successful initialization is the separately recorded boundary. -/
inductive BeforeStep (A : Nat → Prop) (s : State) (b : Balances) : Change → State → Balances → Prop where
  | mutation {ch post fin} : MarkerCompleted A s b ch post fin → BeforeStep A s b ch post fin
  | view (name : String) (viewName : name ∈ Coverage.views) (c : Context)
      (args : List Source.Value) (post : State) (out : List Source.Value)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name name) c s args=some (.returned post out)) :
      BeforeStep A s b .unchanged post b
  | reverted (name : String) (public_ : name ∈ Coverage.publicNames) (c : Context)
      (args : List Source.Value) (post : State) (err : RevertData)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name name) c s args=some (.reverted post err)) :
      BeforeStep A s b .unchanged post b

inductive BeforeHistory (A : Nat → Prop) : State → Balances → State → Balances → Prop where
  | nil (s b) : BeforeHistory A s b s b
  | cons {s t post b mid fin ch} : BeforeStep A s b ch t mid →
      BeforeHistory A t mid post fin → BeforeHistory A s b post fin

theorem beforeStepZero {A s post b fin ch} (step : BeforeStep A s b ch post fin)
    (sep : SlotSeparation A) (book : Books A s b) (zero : s.loadSlot theoretical.slot=0)
    (empty : total b=0) (markerKeys : BalanceApart A) :
    Books A post fin ∧ post.loadSlot theoretical.slot=0 ∧ total fin=0 := by
  have accounts : Books A post fin ∧ ch.apply (observed s)=some (observed post) := by
    cases step with
    | mutation actual =>
      have h := markerCompletedAccounts actual sep book (by omega) (by rw [zero]; decide) markerKeys
      exact ⟨h.1,h.2.1⟩
    | view name viewName c args post out actual =>
      have same := ReadEvidence.publicReadStorage 50000 s post c name args out viewName actual
      have slots (q : Nat) : post.loadSlot q=s.loadSlot q := by simp only [State.loadSlot,same]
      exact ⟨book.ofStorageEq same,by simp [Change.apply,observed,slots]⟩
    | reverted name public_ c args post err actual =>
      have eq := revertedState 50000 s post c name args err actual
      subst post; exact ⟨book,rfl⟩
  have circ : s.loadSlot circulating.slot=0 := book.issued.trans empty
  have cap : post.loadSlot theoretical.slot=0 := by
    have h := accounts.2
    cases ch with
    | mint amount =>
      simp only [Change.apply,observed,zero,circ] at h
      split at h
      · exact (congrArg Supply.theoretical (Option.some.inj h)).symm
      · contradiction
    | burn amount =>
      simp only [Change.apply,observed,zero,circ] at h
      split at h
      · have eq := congrArg Supply.theoretical (Option.some.inj h)
        simpa using eq.symm
      · contradiction
    | unchanged =>
      exact (congrArg Supply.theoretical (Option.some.inj h)).symm.trans zero
  have solvent := (accountingStep 0 0 _ _ _ (by simp [observed,zero,circ])
    (by simp [observed,zero,circ]) accounts.2).2
  exact ⟨accounts.1,cap,by simpa only [observed,accounts.1.issued,cap,Nat.le_zero] using solvent⟩

theorem beforeHistoryZero {A s before b fin} (h : BeforeHistory A s b before fin)
    (sep : SlotSeparation A) (markerKeys : BalanceApart A) (book : Books A s b)
    (cap : s.loadSlot theoretical.slot=0) (empty : total b=0) :
    Books A before fin ∧ before.loadSlot theoretical.slot=0 ∧ total fin=0 := by
  induction h with
  | nil => exact ⟨book,cap,empty⟩
  | cons step rest ih =>
    obtain ⟨books,zero,empty⟩ := beforeStepZero step sep book cap empty markerKeys
    exact ih books zero empty

theorem beforeHistoryEmpty {A genesis before fin} (history : BeforeHistory A genesis [] before fin)
    (sep : SlotSeparation A) (book : Books A genesis [])
    (zero : genesis.loadSlot theoretical.slot=0) (markerKeys : BalanceApart A) :
    Books A before [] ∧ before.loadSlot theoretical.slot=0 := by
  obtain ⟨books,cap,empty⟩ := beforeHistoryZero history sep markerKeys book zero rfl
  refine ⟨⟨?_,books.issued.trans empty⟩,cap⟩
  intro a ha
  have bound := balanceLE a fin
  have z : balance a fin=0 := by omega
  simpa only [balance,List.filter_nil,List.map_nil,List.sum_nil] using (books.balances a ha).trans z
#print axioms beforeHistoryEmpty
end Inv39.FullPublic
