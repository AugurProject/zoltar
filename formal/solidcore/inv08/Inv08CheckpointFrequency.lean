import Inv08CheckpointHistory
open SolidCore.Solidity.Source
namespace Inv08.Checkpoint
open FundingHistory

/-- Two sequences of actual checkpoints with the same cutoff and endpoints
return identical amounts and leave identical deferred balances for both assets. -/
theorem frequency (fuel : Nat) (F : Funded s d fs) (sep : Separated fs.length) (budget : Budgeted s)
    (clock : stored s .through=start) (a : Schedule cutoff s start xs stop) (b : Schedule cutoff s start ys stop) :
    ∃ first last e p, run fuel cutoff s xs=some (first,e,p) ∧ run fuel cutoff s ys=some (last,e,p) ∧
      (∀ eth, bucket first eth=bucket last eth) ∧ Totals s first d fs start stop cutoff (fun eth => if eth then e else p) := by
  obtain ⟨first,e,p,one,_,_,_,T⟩ := history fuel F sep budget clock a
  obtain ⟨last,x,y,two,_,_,_,U⟩ := history fuel F sep budget clock b
  have sameE : x=e := Nat.add_left_cancel ((U.eligible true).trans (T.eligible true).symm)
  have sameP : y=p := Nat.add_left_cancel ((U.eligible false).trans (T.eligible false).symm)
  subst x; subst y
  refine ⟨first,last,e,p,one,two,?_,T⟩
  intro eth
  exact Nat.add_right_cancel (Nat.add_right_cancel ((T.combined eth).trans (U.combined eth).symm))

theorem endpoints (h : Schedule cutoff s start cs stop) : start≤stop := by
  induction h with
  | nil => exact le_rfl
  | cons c forward _ _ _ _ _ ih => exact forward.trans ih

/-- When eligibility covers the interval, all newly vested amounts reach the
caller, and neither deferred balance changes. -/
theorem fullyEligible (fuel : Nat) (F : Funded s d fs) (sep : Separated fs.length) (budget : Budgeted s)
    (clock : stored s .through=start) (a : Schedule cutoff s start xs stop) (valid : stop≤cutoff) :
    ∃ last e p, run fuel cutoff s xs=some (last,e,p) ∧ ∀ eth,
      vested d start fs eth+(if eth then e else p)=vested d stop fs eth ∧ bucket last eth=bucket s eth := by
  obtain ⟨last,e,p,run,_,_,_,T⟩ := history fuel F sep budget clock a
  refine ⟨last,e,p,run,fun eth => ?_⟩
  have earned := T.eligible eth
  rw [min_eq_left ((endpoints a).trans valid),min_eq_left valid] at earned
  have sum := T.combined eth
  refine ⟨earned,?_⟩
  rw [Nat.add_assoc,Nat.add_comm (if eth then e else p),earned] at sum
  exact Nat.add_right_cancel sum

/-- An already expired cutoff returns zero, while both deferred balances gain
the entire vested difference for the interval. -/
theorem fullyDeferred (fuel : Nat) (F : Funded s d fs) (sep : Separated fs.length) (budget : Budgeted s)
    (clock : stored s .through=start) (a : Schedule cutoff s start xs stop) (expired : cutoff≤start) :
    ∃ last, run fuel cutoff s xs=some (last,0,0) ∧ ∀ eth, bucket last eth+vested d start fs eth=bucket s eth+vested d stop fs eth := by
  obtain ⟨last,e,p,run,_,_,_,T⟩ := history fuel F sep budget clock a
  have zero (eth : Bool) := T.eligible eth
  have E := zero true
  have P := zero false
  simp only [min_eq_right expired,min_eq_right (expired.trans (endpoints a)),Bool.false_eq_true,if_false,if_true] at E P
  have e0 : e=0 := by omega
  have p0 : p=0 := by omega
  subst e; subst p
  exact ⟨last,run,fun eth => by simpa using T.combined eth⟩

/-- At or after every stream's expiry, the returned and deferred portions
together account for every funded unit, including accrual before the interval. -/
theorem allVested (fuel : Nat) (F : Funded s d fs) (sep : Separated fs.length) (budget : Budgeted s)
    (clock : stored s .through=start) (a : Schedule cutoff s start xs stop)
    (expired : ∀ f∈fs, f.time+d≤stop) :
    ∃ last e p, run fuel cutoff s xs=some (last,e,p) ∧ ∀ eth,
      bucket last eth+(if eth then e else p)+vested d start fs eth=bucket s eth+totalRate (streams eth fs) := by
  obtain ⟨last,e,p,run,_,_,_,T⟩ := history fuel F sep budget clock a
  exact ⟨last,e,p,run,fun eth => (T.combined eth).trans (congrArg (bucket s eth+·) (finalAmount d stop fs eth F.accounts.positive expired))⟩
end Inv08.Checkpoint
