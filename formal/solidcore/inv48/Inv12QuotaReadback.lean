import Inv12AllocationRun
import Inv12CoordinatorMath
open SolidCore.Solidity.Source Inv03.Bodies Inv32OneArg
namespace Inv12

theorem chooseStoresQuotient (n : Nat) (c : Context) (r : Runtime) (fork branch : Ref)
    (f : fork.bound r "fork") (b : branch.bound r "branch") (cash : fork.hasField 2 2)
    (chosen : branch.hasField 5 4) (total : fork.hasField 1 1) (dest : branch.hasField 6 5)
    (pos : 0<fork.get r.state 1) (covered : branch.get r.state 4≤fork.get r.state 1) :
    ∃ code next, allocationCode=some code ∧ Stmt.evalList (n+15) model.core.table c r code=
      pure (.normal next) ∧ branch.get next.state 5=
        fork.get r.state 2 * branch.get r.state 4 / fork.get r.state 1 := by
  obtain ⟨code,selected,ev⟩ := runAllocation n model.core.table productLinked floorLinked
    c r fork branch f b cash chosen total dest pos covered
  exact ⟨code,_,selected,ev,amountAfter r.state branch.slot 5 _
    (branchFits _ _ _ (fork.fits r.state 2) covered)⟩
#print axioms chooseStoresQuotient
end Inv12
