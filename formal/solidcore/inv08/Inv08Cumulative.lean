import Inv08HistoryReady
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory

def vested (d tm : Nat) (fs : List Funding) (eth : Bool) :=
  (integral d tm (streams eth fs)-baseline (streams eth fs))/d

theorem lifetimeAfter (H : Accounts s d fs paid) (tm : Nat) (forward : stored s .through≤tm) (eth : Bool) :
    paid eth + Preview.payout s tm eth = vested d tm fs eth := by
  unfold Preview.payout vested
  rw [valueEq H tm forward,H.cursor,H.duration]
  apply next _ _ _ _ H.positive
  exact (H.earned eth).trans (monotone _ _ _ _ forward)

theorem finalAmount (d tm : Nat) (fs : List Funding) (eth : Bool) (pos : 0<d)
    (expiredAll : ∀ f∈fs, f.time+d≤tm) : vested d tm fs eth = totalRate (streams eth fs) := by
  have ends : ∀ x∈streams eth fs, x.fundedAt+d≤tm := by
    intro x m
    obtain ⟨f,h,rfl⟩ := List.mem_map.mp m
    exact expiredAll f h
  rw [vested,expired _ _ _ ends,Nat.add_sub_cancel_left,Nat.mul_div_cancel _ pos]
  rfl

theorem generatedPreview (n : Nat) (c : Context) (r : Runtime) (arg : String) (targets : List String)
    (d tm : Nat) (fs : List Funding) (paid : Bool → Nat) (H : Accounts r.state d fs paid)
    (found : r.lookupLocal? arg = some (.word tm)) (fields : c.storageFields=model.core.context.storageFields)
    (time : tm<2^48) (forward : stored r.state .through ≤ tm) :
    Stmt.eval (n+63) model.core.table c r (.internalCall targets Preview.key [.var arg]) =
      internalCallAssign r targets [.word (vested d tm fs true-paid true),.word (vested d tm fs false-paid false),
        .word (Preview.q r.state tm)] := by
  rw [Preview.call _ _ _ _ _ _ found fields (ready H tm time forward).toReady]
  rw [←lifetimeAfter H tm forward true,←lifetimeAfter H tm forward false,Nat.add_sub_cancel_left,Nat.add_sub_cancel_left]
end Inv08.FundingHistory
