import Inv12RegisteredRefs
import Inv12Distribution
import Inv12RecoveryShape
open SolidCore.Solidity.Source
namespace Inv12

def nonempty (ks : List Nat) := ks.filter (fun k => k != 0)

theorem contributing (cash total : Nat) (ks : List Nat) :
    (nonempty ks).sum=ks.sum ∧ assigned cash total (nonempty ks)=assigned cash total ks := by
  induction ks with
  | nil => exact ⟨rfl,rfl⟩
  | cons k ks ih =>
    obtain ⟨S,A⟩ := ih
    cases k with
    | zero => simpa [nonempty,assigned] using And.intro S A
    | succ k => simp_all [nonempty,assigned]

theorem fullChoiceBound (f : Ref) (bs : List Ref) (r : Runtime) (cash total : Nat)
    (dist : Distribution f bs cash total r.state) (positive : 0<total) (covered : (weights r.state bs).sum=total) :
    f.get r.state 5≤cash ∧ cash-f.get r.state 5<(nonempty (weights r.state bs)).length := by
  obtain ⟨S,A⟩ := contributing cash total (weights r.state bs)
  have B := roundedAllocation cash total _ positive (S.trans covered)
  rw [A,←dist.assignedTotal] at B
  exact B

theorem recoverNonempty (n : Nat) (c : Context) (r : Runtime) (f : Ref) (bs : List Ref) (cash total : Nat)
    (fork : f.bound r "fork") (fields : ForkLayout f) (dist : Distribution f bs cash total r.state)
    (positive : 0<total) (covered : (weights r.state bs).sum=total) :
    ∃ next, Stmt.eval (n+1) model.core.table c r neutralWrite.value=pure (.normal next) ∧
      f.get next.state 6<(nonempty (weights r.state bs)).length := by
  have C := contributing cash total (weights r.state bs)
  apply recoveryBound n c r f _ fork fields.2.1 fields.2.2.1 fields.2.2.2
  · rw [dist.frozenCommitment];exact positive
  · rw [dist.frozenCommitment];exact C.1.trans covered
  · rw [dist.frozenCash,dist.frozenCommitment,C.2,dist.assignedTotal]
end Inv12
