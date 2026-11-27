import Inv12Inputs
import Inv12Allocation
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies Inv32OneArg
namespace Inv12

def quota (r : Runtime) (fork branch : Ref) :=
  fork.get r.state 2 * branch.get r.state 4 / fork.get r.state 1

theorem writeQuota (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (branch : Ref)
    (b : branch.bound r "branch") (dest : branch.hasField 6 5) (q : Nat) (fit : q<R) :
    Stmt.eval (n+1) t c (store r tmp q) writeCash.value =
      pure (.normal {(store r tmp q) with state:=putAmount r.state branch.slot 5 q}) := by
  have localValue : (store r tmp q).lookupLocal? tmp=some (.word q) := by
    cases h : r.locals <;> simp [store,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?,h]
  have cleaned := Inv08.ReleaseQuote.readClean
    (Inv08.Authority.castBits (Inv08.localReads c _ _ _ localValue) 256 (by decide) (by decide) fit) fit
  exact assignField n t c _ "branch" branch.slot 6 5 q branch.members _ (by decide)
    (branch.afterDecl b tmp (.word q) (by decide)) dest (cleaned _ (Nat.le_succ _))

theorem runAllocation (n : Nat) (t : FunctionTable) (mul : Inv32Internal.ProductLinked t)
    (floor : Inv32FloorCall.FloorLinked t) (c : Context) (r : Runtime) (fork branch : Ref)
    (f : fork.bound r "fork") (b : branch.bound r "branch") (cash : fork.hasField 2 2)
    (chosen : branch.hasField 5 4) (total : fork.hasField 1 1) (dest : branch.hasField 6 5)
    (pos : 0<fork.get r.state 1) (covered : branch.get r.state 4≤fork.get r.state 1) :
    ∃ code, allocationCode=some code ∧ Stmt.evalList (n+15) t c r code=
      pure (.normal {(store r tmp (quota r fork branch)) with
        state:=putAmount r.state branch.slot 5 (quota r fork branch)}) := by
  refine ⟨_,fromCoordinator,?_⟩
  have fits := branchFits _ _ _ (fork.fits r.state 2) covered
  have hoisted := Inv32FloorHoist.successAt t mul floor n c r tmp _ _ _ _ _ _
    (fork.fits _ _) (branch.fits _ _) (fork.fits _ _) pos fits
    (allocationInputs c r fork branch f b cash chosen total) (by decide) (by decide) (by decide) (by decide)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+14) t c r tmp)).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ hoisted).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ (writeQuota (n+14) t c r branch b dest _ fits)).trans
    (by rw [Stmt.evalList]; rfl)))

end Inv12
