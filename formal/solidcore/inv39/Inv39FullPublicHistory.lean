import Inv39PublicReads
import Inv39FullPublicRollback
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.FullPublic
/-- Returned mutations retain their local physical-key certificates. Reverted calls
carry the actual interpreter result, including attempted repeat initialization.
A returned repeat initializer is admitted syntactically and eliminated by proof. -/
inductive Step (A : Nat → Prop) (s : State) (b : Balances) : Change → State → Balances → Prop where
  | mutation {ch post fin} : MarkerCompleted A s b ch post fin → Step A s b ch post fin
  | view (name : String) (viewName : name ∈ Coverage.views) (c : Context)
      (args : List Source.Value) (post : State) (out : List Source.Value)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name name) c s args=some (.returned post out)) :
      Step A s b .unchanged post b
  | reverted (name : String) (public_ : name ∈ Coverage.publicNames) (c : Context)
      (args : List Source.Value) (post : State) (err : RevertData)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name name) c s args=some (.reverted post err)) :
      Step A s b .unchanged post b
  | repeatInitialization (caller self uid cap rep : Nat) (post : State) (out : List Source.Value)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
        (Child.callContext caller self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
      Step A s b .unchanged post b

inductive History (A : Nat → Prop) : State → Balances → List Change → State → Balances → Prop where
  | nil (s b) : History A s b [] s b
  | cons {s t post b mid fin ch tail} : Step A s b ch t mid →
      History A t mid tail post fin → History A s b (ch::tail) post fin

theorem stepAccounts {A s post b fin ch} (step : Step A s b ch post fin)
    (sep : SlotSeparation A) (book : Books A s b)
    (solvent : total b≤s.loadSlot theoretical.slot) (fit : s.loadSlot theoretical.slot<R)
    (markerKeys : BalanceApart A) (initialized : Shared.norm (s.loadSlot 7)≠0) :
    Books A post fin ∧ ch.apply (observed s)=some (observed post) ∧
      post.loadSlot theoretical.slot<R ∧ post.loadSlot 7=s.loadSlot 7 := by
  cases step with
  | mutation actual => exact markerCompletedAccounts actual sep book solvent fit markerKeys
  | view name viewName c args post out actual =>
    have same := ReadEvidence.publicReadStorage 50000 s post c name args out viewName actual
    have sameSlot (q : Nat) : post.loadSlot q=s.loadSlot q := by simp only [State.loadSlot,same]
    exact ⟨book.ofStorageEq same,by simp [Change.apply,observed,sameSlot],(sameSlot _).symm ▸ fit,sameSlot _⟩
  | reverted name public_ c args post err actual =>
    have eq := revertedState 50000 s post c name args err actual
    subst post
    exact ⟨book,rfl,fit,rfl⟩
  | repeatInitialization caller self uid cap rep post out actual =>
    exact False.elim (Init.Repeat.publicExclusion s post caller self uid cap rep out initialized actual)

theorem historyAccounts {A s post b fin changes} (history : History A s b changes post fin)
    (sep : SlotSeparation A) (book : Books A s b)
    (solvent : total b≤s.loadSlot theoretical.slot) (fit : s.loadSlot theoretical.slot<R)
    (markerKeys : BalanceApart A) (initialized : Shared.norm (s.loadSlot 7)≠0) :
    changes.foldlM (fun acc ch => ch.apply acc) (observed s)=some (observed post) ∧
      Books A post fin ∧ post.loadSlot theoretical.slot<R ∧ post.loadSlot 7=s.loadSlot 7 := by
  induction history with
  | nil => exact ⟨rfl,book,fit,rfl⟩
  | @cons s t post b mid fin ch tail step rest ih =>
    obtain ⟨books,applied,bound,same⟩ := stepAccounts step sep book solvent fit markerKeys initialized
    have pre : (observed s).circulating≤(observed s).theoretical := by
      simpa only [observed,book.issued] using solvent
    have budget := (accountingStep _ 0 _ _ _
      (show (observed s).theoretical+0=((observed s).theoretical-(observed s).circulating)+(observed s).circulating from by omega)
      pre applied).2
    have marked : Shared.norm (t.loadSlot 7)≠0 := by rwa [same]
    obtain ⟨trace,last,range,marker⟩ := ih books (by simpa only [observed,books.issued] using budget) bound marked
    refine ⟨?_,last,range,marker.trans same⟩
    rw [List.foldlM,applied]
    exact trace

theorem headroom {A s post fin changes} (history : History A s [] changes post fin)
    (sep : SlotSeparation A) (book : Books A s []) (fit : s.loadSlot theoretical.slot<R)
    (markerKeys : BalanceApart A) (initialized : Shared.norm (s.loadSlot 7)≠0) :
    post.loadSlot theoretical.slot-post.loadSlot circulating.slot=
      s.loadSlot theoretical.slot-(changes.map Change.minted).sum ∧
    (changes.map Change.minted).sum≤s.loadSlot theoretical.slot ∧
    post.loadSlot 7=s.loadSlot 7 := by
  obtain ⟨trace,_,_,same⟩ := historyAccounts history sep book (Nat.zero_le _) fit markerKeys initialized
  have issued : (observed s).circulating=0 := book.issued
  have account := accountingHistory (observed s).theoretical 0 _ _ _ (by simp [issued])
    (by rw [issued]; exact Nat.zero_le _) trace
  simpa only [observed,Nat.zero_add] using And.intro account.1 (And.intro account.2 same)
#print axioms historyAccounts
#print axioms headroom
end Inv39.FullPublic
