import Inv12Nonempty
import Inv12ChoiceCall
open SolidCore.Solidity.Source Inv32Division
namespace Inv12

def cashCode := creditPrefix.value++[.block callbackCode,.exprStmt (addMember "fork" 5 deltaExpr)]

structure ChoiceContext (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (rep extra : Nat) (rows : ScriptedResponder) : Prop where
  fork : f.bound r "fork"
  branch : b.bound r "branch"
  forkLayout : ForkLayout f
  branchLayout : BranchLayout b
  repRead : r.lookupLocal? "rep"=some (.word rep)
  commitmentRead : r.lookupLocal? "commitment"=some (.word extra)
  backingFits : b.get r.state 3+rep<R
  callback : let a := afterCredits r f b rep extra
    ∃ next, (Stmt.eval (n+15) model.core.table c a (.block callbackCode)).runWith rows=.ok (.normal next) ∧
      next.locals=a.locals ∧ ∀ g off, Ref.get g next.state off=g.get a.state off

theorem stepPreserves (n : Nat) (c : Context) (r next : Runtime) (f b : Ref) (pre post : List Ref)
    (cash total rep extra : Nat) (rows : ScriptedResponder) (ctx : ChoiceContext n c r f b rep extra rows)
    (separation : BranchSeparation f b (pre++post)) (positive : 0<total)
    (dist : Distribution f (pre++b::post) cash total r.state)
    (within : (weights r.state pre++[b.get r.state 4+extra]++weights r.state post).sum≤total)
    (run : (Stmt.evalList (n+15) model.core.table c r cashCode).runWith rows=.ok (.normal next)) :
    Distribution f (pre++b::post) cash total next.state := by
  let old := b.get r.state 4
  have member : b ∈ pre++b::post := by simp
  have parent := dist.parents b member
  rw [←dist.frozenCash,←dist.frozenCommitment] at parent
  have assignedBefore := dist.assignedTotal
  rw [←dist.frozenCash,←dist.frozenCommitment] at assignedBefore
  have repr : weights r.state (pre++b::post)=weights r.state pre++[old]++weights r.state post := by simp [weights,old]
  rw [repr] at assignedBefore
  have fin := ctx.forkLayout
  have bin := ctx.branchLayout
  obtain ⟨result,ev,A,P⟩ := choiceHistoryFrame n c r f b rep extra old (weights r.state pre) (weights r.state post) rows
    ctx.fork ctx.branch fin.2.1 fin.1 bin.1 bin.2.1 bin.2.2 fin.2.2.1 ctx.repRead ctx.commitmentRead ctx.backingFits
    (dist.frozenCommitment ▸ positive) rfl parent assignedBefore (dist.frozenCommitment ▸ within)
    (fun i h j k => separation.fork i (by simp at h ⊢;tauto) j (by simp at k ⊢;tauto))
    (fun i h => separation.fork i h 5 (by decide))
    (Ne.symm (separation.fork 4 (by decide) 5 (by decide))) (Ne.symm (separation.fork 5 (by decide) 5 (by decide)))
    ctx.callback
  change (Stmt.evalList (n+15) model.core.table c r cashCode).runWith rows=_ at ev
  rw [run] at ev
  cases ev
  rw [dist.frozenCash,dist.frozenCommitment] at A
  exact distributionStep _ _ _ _ _ _ _ _ _ dist separation P A
end Inv12
