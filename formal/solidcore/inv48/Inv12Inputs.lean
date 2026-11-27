import Inv12Ref
import Inv12ChoiceShape
open SolidCore.Solidity.Source Inv03.Bodies Inv32FloorHoist Inv32OneArg
namespace Inv12

theorem allocationInputs (c : Context) (r : Runtime) (fork branch : Ref)
    (f : fork.bound r "fork") (b : branch.bound r "branch")
    (cash : fork.hasField 2 2) (chosen : branch.hasField 5 4) (total : fork.hasField 1 1) :
    Inputs c r tmp (member "fork" 2).value (member "branch" 5).value (member "fork" 1).value
      (fork.get r.state 2) (branch.get r.state 4) (fork.get r.state 1) := by
  have f0 := fork.afterScope (fork.afterDecl f tmp (.word 0) (by decide))
  have b0 := branch.afterScope (branch.afterDecl b tmp (.word 0) (by decide))
  have b1 := branch.afterDecl b0 a0 (.word (fork.get r.state 2)) (by decide)
  have f1 := fork.afterDecl f0 a0 (.word (fork.get r.state 2)) (by decide)
  have f2 := fork.afterDecl f1 a1 (.word (branch.get r.state 4)) (by decide)
  exact ⟨fork.cleanRead c _ _ 2 2 (by decide) f0 cash _ (Nat.le_succ _),
    branch.cleanRead c _ _ 5 4 (by decide) b1 chosen _ (Nat.le_succ _),
    fork.cleanRead c _ _ 1 1 (by decide) f2 total _ (Nat.le_succ _)⟩

end Inv12
