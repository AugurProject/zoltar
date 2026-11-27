import Inv12Snapshot
open SolidCore.Solidity.Source Inv32Division
namespace Inv12
def quotaState (r : Runtime) (f b : Ref) : Runtime :=
  {(Inv32OneArg.store r Inv03.Bodies.tmp (quota r f b)) with state:=putAmount r.state b.slot 5 (quota r f b)}

theorem exactChoiceWrites (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (extra : Nat)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (cash : f.hasField 2 2)
    (total : f.hasField 1 1) (chosen : b.hasField 5 4) (dest : b.hasField 6 5)
    (look : r.lookupLocal? "commitment"=some (.word extra)) (positive : 0<f.get r.state 1)
    (covered : b.get r.state 4+extra≤f.get r.state 1)
    (denomSeparate : b.addressOf 4≠f.addressOf 1) (cashSeparate : b.addressOf 4≠f.addressOf 2) :
    let mid := credit r b 4 extra
    let next := quotaState mid f b
    ∃ code, allocationCode=some code ∧
      Stmt.evalList (n+15) model.core.table c r
        (.exprStmt (addMember "branch" 5 (.var "commitment")) :: totalGuard :: code) = pure (.normal next) ∧
      b.get next.state 5=f.get r.state 2*(b.get r.state 4+extra)/f.get r.state 1 := by
  let mid := credit r b 4 extra
  have fits := lt_of_le_of_lt covered (f.fits r.state 1)
  have C := creditLocal (n+14) model.core.table c r b 5 4 "commitment" extra branch (by decide) chosen look fits
  have D : f.get mid.state 1=f.get r.state 1 := otherAmount _ _ _ _ _ _ denomSeparate
  have A : f.get mid.state 2=f.get r.state 2 := otherAmount _ _ _ _ _ _ cashSeparate
  have K : b.get mid.state 4=b.get r.state 4+extra := amountAfter _ _ _ _ fits
  have p : 0<f.get mid.state 1 := D ▸ positive
  have bound : b.get mid.state 4≤f.get mid.state 1 := by rw [K,D]; exact covered
  have G := funded (n+14) model.core.table c mid f fork total p
  obtain ⟨code,selected,ev⟩ := runAllocation n model.core.table productLinked floorLinked c mid f b
    fork branch cash chosen total dest p bound
  refine ⟨code,selected,(Inv32FloorStart.seqStep _ _ _ _ _ _ _ C).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ G).trans ev),?_⟩
  change amountAt (putAmount mid.state b.slot 5 (quota mid f b)) b.slot 5=_
  unfold quota
  rw [amountAfter _ _ _ _ (branchFits _ _ _ (f.fits mid.state 2) bound)]
  rw [A,D,K]
end Inv12
