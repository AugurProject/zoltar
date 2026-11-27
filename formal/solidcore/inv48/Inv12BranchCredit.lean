import Inv12LedgerFrame
import Inv12AssignedFrame
open SolidCore.Solidity.Source Inv32Division
namespace Inv12

theorem chosenAfterCredits (r : Runtime) (f b : Ref) (rep extra : Nat) (fit : b.get r.state 4+extra<R) :
    b.get (afterCredits r f b rep extra).state 4 = b.get r.state 4+extra := by
  let saved := saveCash r b
  let backed := credit saved b 3 rep
  let chosen := credit backed b 4 extra
  have B : b.get backed.state 4=b.get r.state 4 := otherAmount _ _ _ _ _ _ (b.distinctOffsets 3 4 (by decide) (by decide) (by decide))
  have C : b.get chosen.state 4=b.get backed.state 4+extra :=
    amountAfter _ _ _ _ (by rw [B];exact fit)
  have Q : b.get (quotaState chosen f b).state 4=b.get chosen.state 4 :=
    otherAmount _ _ _ _ _ _ (b.distinctOffsets 5 4 (by decide) (by decide) (by decide))
  rw [B] at C
  exact Q.trans C

structure CreditPost (f b : Ref) (s next : State) (extra : Nat) : Prop where
  chosen : b.get next 4=b.get s 4+extra
  cash : b.get next 5=f.get s 2*(b.get s 4+extra)/f.get s 1
  other : ∀ (g : Ref) (off : Nat), f.addressOf 5≠g.addressOf off →
    (∀ i ∈ [3,4,5], b.addressOf i≠g.addressOf off) → g.get next off=g.get s off

end Inv12
