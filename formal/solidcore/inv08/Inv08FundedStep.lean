import Inv08ReachableAccounting
import Inv08Budgeted
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory
theorem fundedTransport (s t : State) (same : t.storage=s.storage) (F : Funded s d fs) : Funded t d fs := by
  have clock := scalarCongr t s .through (by simp [State.loadSlot,same])
  refine ⟨?_,F.count⟩
  rw [clock]; exact transport _ _ same F.accounts

theorem fundedAdd (F : Funded s d xs) (h : Step d f xs ys) (sep : Separated ys.length)
    (now : stored s .through=f.time) (ends : f.time+d<2^48) (nonzero : f.eth≠0 ∨ f.rep≠0)
    (room : ∀ eth,stored s (outstandingField eth)+(stream eth f).budget+stored s (deferredField eth)<2^128) :
    Funded (AddStream.post s f (record d xs)) d ys ∧ Budgeted (AddStream.post s f (record d xs)) := by
  obtain ⟨domain,_,_,nextCount,cnt⟩ := fundingDomain F.accounts h F.count now ends nonzero room sep
  have idEq := stepId F.accounts.records F.accounts.duration h
  have clock := (AddStream.clockFields s f (record d xs) _ sep idEq.le domain.idFit).1
  have after := afterFunding F.accounts h sep now.symm cnt ends (fun eth => lt_of_le_of_lt (Nat.le_add_right _ _) (room eth))
  refine ⟨⟨?_,nextCount⟩,addBudget _ _ _ sep idEq.le room⟩
  rw [clock,now]
  have paid : vested d f.time ys = vested d f.time xs := funext (vestedAtFunding h)
  rw [paid,←now]; exact after

end Inv08.FundingHistory
