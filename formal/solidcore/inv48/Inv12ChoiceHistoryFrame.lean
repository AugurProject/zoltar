import Inv12BranchCredit
import Inv12PremiumBlock
import Inv12AssignedFrame
import Inv12FoldAppend
import Inv12CreditShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv12

theorem choiceHistoryFrame (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (rep extra old : Nat)
    (before after : List Nat) (rows : ScriptedResponder)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (cash : f.hasField 2 2) (total : f.hasField 1 1)
    (backing : b.hasField 4 3) (chosen : b.hasField 5 4) (amount : b.hasField 6 5) (ledger : f.hasField 5 5)
    (repV : r.lookupLocal? "rep"=some (.word rep)) (comm : r.lookupLocal? "commitment"=some (.word extra))
    (backFit : b.get r.state 3+rep<R) (pos : 0<f.get r.state 1) (previous : b.get r.state 4=old)
    (parent : b.get r.state 5=f.get r.state 2*old/f.get r.state 1)
    (prior : f.get r.state 5=assigned (f.get r.state 2) (f.get r.state 1) (before++[old]++after))
    (covered : (before++[old+extra]++after).sum≤f.get r.state 1)
    (sep : ∀ i ∈ [3,4], ∀ j ∈ [1,2], b.addressOf i≠f.addressOf j)
    (sepA : ∀ i ∈ [3,4,5], b.addressOf i≠f.addressOf 5)
    (sepChosen : f.addressOf 5≠b.addressOf 4)
    (sepCash : f.addressOf 5≠b.addressOf 5)
    (callback : let a := afterCredits r f b rep extra
      ∃ next, (Stmt.eval (n+15) model.core.table c a (.block callbackCode)).runWith rows=.ok (.normal next) ∧
        next.locals=a.locals ∧ ∀ g off, Ref.get g next.state off=g.get a.state off) :
    ∃ next, (Stmt.evalList (n+15) model.core.table c r (creditPrefix.value++[.block callbackCode,
       .exprStmt (addMember "fork" 5 deltaExpr)])).runWith rows=.ok (.normal next) ∧
      f.get next.state 5=assigned (f.get r.state 2) (f.get r.state 1) (before++[old+extra]++after) ∧ CreditPost f b r.state next.state extra := by
  let a := afterCredits r f b rep extra
  have cap : b.get r.state 4+extra≤f.get r.state 1 := by
    rw [previous]
    simp only [List.sum_append,List.sum_cons,List.sum_nil,Nat.add_zero] at covered
    exact le_trans (Nat.le_add_left _ _) (le_trans (Nat.le_add_right _ _) covered)
  obtain ⟨q,selected,S,Q,P⟩ := snapshotAndAllocate n c r f b rep extra fork branch cash total backing chosen amount repV comm backFit pos cap sep
  rw [fromCoordinator] at selected; cases selected
  have first : (Stmt.evalList (n+15) model.core.table c r creditPrefix.value).runWith rows=.ok (.normal a) := by
    change Stmt.evalList (n+15) model.core.table c r creditPrefix.value=pure (.normal a) at S
    rw [S];rfl
  obtain ⟨cb,C,L,V⟩ := callback
  have localEq (name : String) : cb.lookupLocal? name=a.lookupLocal? name := by unfold Runtime.lookupLocal?;rw [L]
  have sameRef (g : Ref) (name : String) (h : g.bound a name) : g.bound cb name := by
    unfold Ref.bound Runtime.lookupStorageBase? at *; rw [localEq];exact h
  have A := (V f 5).trans ((untouchedDuringCredit r f b rep extra f 5 sepA).trans prior)
  have B := (V b 5).trans Q
  rw [previous] at B
  have prev := (localEq "previousCash").trans P
  rw [parent] at prev
  obtain ⟨next,ev,sum,frame⟩ := preserveAssignedAndFrame (n+14) model.core.table c cb f b _ _ old extra before after
    (sameRef f "fork" (aliasDuringCredit _ _ _ _ _ _ _ fork (by decide) (by decide)))
    (sameRef b "branch" (aliasDuringCredit _ _ _ _ _ _ _ branch (by decide) (by decide)))
    amount ledger prev A B (f.fits _ _) (f.fits _ _) pos covered
  have chose : b.get a.state 4=b.get r.state 4+extra :=
    chosenAfterCredits _ _ _ _ _ (lt_of_le_of_lt cap (f.fits _ _))
  have saved : CreditPost f b r.state next.state extra :=
    ⟨(frame b 4 sepChosen).trans ((V b 4).trans chose),
     (frame b 5 sepCash).trans ((V b 5).trans Q),
     fun g off fs bs => (frame g off fs).trans ((V g off).trans (untouchedDuringCredit r f b rep extra g off bs))⟩
  refine ⟨next,?_,sum,saved⟩
  rw [normalAppend _ _ _ _ _ _ _ _ first,externalSeq _ _ _ _ _ _ _ _ C,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ ev,Stmt.evalList];rfl

end Inv12
