import Inv12ChoicePrefix
open SolidCore.Solidity.Source
namespace Inv12

theorem untouchedDuringCredit (r : Runtime) (f b : Ref) (rep extra : Nat) (g : Ref) (off : Nat)
    (separate : ∀ i ∈ [3,4,5], b.addressOf i≠g.addressOf off) :
    g.get (afterCredits r f b rep extra).state off=g.get r.state off := by
  let saved := saveCash r b
  let backed := credit saved b 3 rep
  let chosen := credit backed b 4 extra
  have H : g.get (quotaState chosen f b).state off=g.get chosen.state off :=
    otherAmount _ _ _ _ _ _ (separate 5 (by decide))
  have C : g.get chosen.state off=g.get backed.state off :=
    otherAmount _ _ _ _ _ _ (separate 4 (by decide))
  have B : g.get backed.state off=g.get saved.state off :=
    otherAmount _ _ _ _ _ _ (separate 3 (by decide))
  exact H.trans (C.trans B)

theorem aliasDuringCredit (r : Runtime) (f b g : Ref) (rep extra : Nat) (name : String)
    (bound : g.bound r name) (s : "previousCash"≠name) (t : Inv03.Bodies.tmp≠name) :
    g.bound (afterCredits r f b rep extra) name := by
  let chosen := credit (credit (saveCash r b) b 3 rep) b 4 extra
  have atChosen : g.bound chosen name := g.afterDecl bound _ _ s
  exact g.afterDecl atChosen _ (.word (quota chosen f b)) t
end Inv12
