import Inv08Model
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv08
def ctx (t : Nat) : Source.Context :=
  let orig := model.core.context
  {orig with self := 2,sender := 1,accountCodes := [(2,List.replicate 64 0 ++ [1])],
             blockEnv := {orig.blockEnv with timestamp := t}}
def action (s : Source.State) (t : Nat) (name : String) (args : List Nat) :=
  TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name name) (ctx t) s (args.map Source.Value.word)
def initial : Option Source.State := do
  let deployed := Source.State.empty.storeImmutable "initializer" (.word 1)
  let .returned initialized [] ← action deployed 0 "initialize" [0,7] | none
  return initialized
def sampleReleases (times : List Nat) : Option (Nat × Nat) := do
  let .returned funded _ ← action (← initial) 0 "addStream" [11,17] | none
  let (_,eth,rep) ← times.foldlM (fun (st,e,r) t => do
    let .returned next [.word a,.word b] ← action st t "release" [t] | none
    return (next,e+a,r+b)) (funded,0,0)
  return (eth,rep)
theorem oneStream : sampleReleases [3,5,7] = some (11,17) ∧ sampleReleases [7] = some (11,17) := by
  native_decide
end Inv08
