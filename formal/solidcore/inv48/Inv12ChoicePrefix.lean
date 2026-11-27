import Inv12ChoiceState
open SolidCore.Solidity.Source Inv32Division
namespace Inv12

def afterCredits (r : Runtime) (f b : Ref) (rep extra : Nat) :=
  quotaState (credit (credit (saveCash r b) b 3 rep) b 4 extra) f b

theorem snapshotAndAllocate (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (rep extra : Nat)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (cash : f.hasField 2 2)
    (total : f.hasField 1 1) (backing : b.hasField 4 3) (chosen : b.hasField 5 4) (dest : b.hasField 6 5)
    (repValue : r.lookupLocal? "rep"=some (.word rep)) (look : r.lookupLocal? "commitment"=some (.word extra))
    (backFits : b.get r.state 3+rep<R) (positive : 0<f.get r.state 1) (covered : b.get r.state 4+extra≤f.get r.state 1)
    (separate : ∀ i ∈ [3,4], ∀ j ∈ [1,2], b.addressOf i≠f.addressOf j) :
    ∃ code, allocationCode=some code ∧ Stmt.evalList (n+15) model.core.table c r
      (snapshotStmt :: .exprStmt (addMember "branch" 4 (.var "rep")) ::
       .exprStmt (addMember "branch" 5 (.var "commitment")) :: totalGuard :: code)=pure (.normal (afterCredits r f b rep extra)) ∧
      b.get (afterCredits r f b rep extra).state 5=f.get r.state 2*(b.get r.state 4+extra)/f.get r.state 1 ∧
      (afterCredits r f b rep extra).lookupLocal? "previousCash"=some (.word (b.get r.state 5)) := by
  let snapshot := saveCash r b
  let backed := credit snapshot b 3 rep
  have F := f.afterDecl fork "previousCash" (.word (b.get r.state 5)) (by decide)
  have B := b.afterDecl branch "previousCash" (.word (b.get r.state 5)) (by decide)
  have repRead : snapshot.lookupLocal? "rep"=some (.word rep) :=
    (lookupOther _ _ _ _ (by decide : "previousCash"≠"rep")).trans repValue
  have committed : backed.lookupLocal? "commitment"=some (.word extra) :=
    (lookupOther _ _ _ _ (by decide : "previousCash"≠"commitment")).trans look
  have S := saveCashRun (n+14) model.core.table c r b branch dest
  have C := creditLocal (n+14) model.core.table c snapshot b 4 3 "rep" rep B (by decide) backing repRead backFits
  have D : f.get backed.state 1=f.get r.state 1 := otherAmount _ _ _ _ _ _ (separate 3 (by decide) 1 (by decide))
  have A : f.get backed.state 2=f.get r.state 2 := otherAmount _ _ _ _ _ _ (separate 3 (by decide) 2 (by decide))
  have K : b.get backed.state 4=b.get r.state 4 := otherAmount _ _ _ _ _ _ (b.distinctOffsets 3 4 (by decide) (by decide) (by decide))
  obtain ⟨code,selected,run,value⟩ := exactChoiceWrites n c backed f b extra F B cash total chosen dest committed
    (D ▸ positive) (by rw [K,D];exact covered) (separate 4 (by decide) 1 (by decide)) (separate 4 (by decide) 2 (by decide))
  refine ⟨code,selected,(Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ C).trans run),?_,?_⟩
  · rw [A,D,K] at value; exact value
  · exact (lookupOther (credit backed b 4 extra) "previousCash" Inv03.Bodies.tmp _ (by decide)).trans (savedCash r b)
end Inv12
