import Inv12CallbackFrame
import Inv12AssignedFrame
import Inv12LedgerStep
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def replied (c : Context) (r : Runtime) (w : Shared.OpenWorld) (interaction : ExternalInteraction) :=
  ({r with state:=adoptWorld w c r.state} : Runtime).recordExternalInteraction interaction

theorem assignedAfterCallback (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (rep extra old : Nat)
    (before after : List Nat) (w : Shared.OpenWorld) (interaction : ExternalInteraction)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (cash : f.hasField 2 2) (total : f.hasField 1 1)
    (backing : b.hasField 4 3) (chosen : b.hasField 5 4) (amount : b.hasField 6 5) (ledger : f.hasField 5 5)
    (repValue : r.lookupLocal? "rep"=some (.word rep)) (comm : r.lookupLocal? "commitment"=some (.word extra))
    (fit : b.get r.state 3+rep<Inv32Division.R) (pos : 0<f.get r.state 1) (prev : b.get r.state 4=old)
    (parent : b.get r.state 5=f.get r.state 2*old/f.get r.state 1)
    (prior : f.get r.state 5=assigned (f.get r.state 2) (f.get r.state 1) (before++[old]++after))
    (covered : (before++[old+extra]++after).sum≤f.get r.state 1)
    (separate : ∀ i ∈ [3,4], ∀ j ∈ [1,2], b.addressOf i≠f.addressOf j)
    (sepAssigned : ∀ i ∈ [3,4,5], b.addressOf i≠f.addressOf 5)
    (reply : selfStore c w=selfStore c (snapshotWorld c (afterCredits r f b rep extra).state))
    (wf : StorageMap.WF (afterCredits r f b rep extra).state.storage) :
    let afterCall := replied c (afterCredits r f b rep extra) w interaction
    ∃ next, Stmt.eval (n+1) model.core.table c afterCall (.exprStmt (addMember "fork" 5 deltaExpr))=pure (.normal next) ∧
      f.get next.state 5=assigned (f.get r.state 2) (f.get r.state 1) (before++[old+extra]++after) := by
  let a := afterCredits r f b rep extra
  let call := replied c a w interaction
  have cap : b.get r.state 4+extra≤f.get r.state 1 := by
    rw [prev]
    simp only [List.sum_append,List.sum_cons,List.sum_nil,Nat.add_zero] at covered
    exact le_trans (Nat.le_add_left _ _) (le_trans (Nat.le_add_right _ _) covered)
  obtain ⟨_,_,_,q,p⟩ := snapshotAndAllocate n c r f b rep extra fork branch cash total backing chosen amount repValue comm fit pos cap separate
  have stable (g : Ref) (off : Nat) : g.get call.state off=g.get a.state off :=
    afterResponse c a w reply (Or.inr rfl) wf g off
  have P : call.lookupLocal? "previousCash"=some (.word (f.get r.state 2*old/f.get r.state 1)) := by
    change a.lookupLocal? "previousCash"=_
    rw [←parent];exact p
  have C : b.get call.state 5=f.get r.state 2*(old+extra)/f.get r.state 1 := by
    rw [stable,←prev];exact q
  have A : f.get call.state 5=assigned (f.get r.state 2) (f.get r.state 1) (before++[old]++after) :=
    (stable _ _).trans ((untouchedDuringCredit r f b rep extra f 5 sepAssigned).trans prior)
  exact preserveAssigned n model.core.table c call f b _ _ old extra before after
    (aliasDuringCredit r f b f rep extra _ fork (by decide) (by decide))
    (aliasDuringCredit r f b b rep extra _ branch (by decide) (by decide))
    amount ledger P A C (f.fits _ _) (f.fits _ _) pos covered
end Inv12
