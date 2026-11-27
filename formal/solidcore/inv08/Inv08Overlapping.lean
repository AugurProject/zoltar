import Inv08Scenario
open SolidCore.Solidity.Source
namespace Inv08
def checkpointAmounts (st : State) (times : List Nat) : Option (State × Nat × Nat) :=
  times.foldlM (fun (s,e,r) t => do
    let .returned next [.word a,.word b] ← action s t "release" [t] | none
    return (next,e+a,r+b)) (st,0,0)
def staggered (times : List Nat) : Option (Nat × Nat) := do
  let .returned first _ ← action (← initial) 0 "addStream" [11,17] | none
  let (middle,eth,rep) ← checkpointAmounts first [2]
  let .returned next _ ← action middle 2 "addStream" [5,9] | none
  let .returned both _ ← action next 2 "addStream" [3,1] | none
  let (_,pe,pr) ← checkpointAmounts both times
  return (eth+pe,rep+pr)
theorem splitExample : staggered [3,6,7,8,9] = some (19,27) ∧ staggered [9] = some (19,27) := by native_decide
end Inv08
