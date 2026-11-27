import Inv12ChoiceState
import SolidCore.Solidity.AdoptionLaws
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def selfStore (c : Context) (w : Shared.OpenWorld) :=
  ((w.accounts.find? (wordToAddress c.self)).getD default).storage

theorem afterResponse (c : Context) (r : Runtime) (w : Shared.OpenWorld)
    (reply : selfStore c w=selfStore c (snapshotWorld c r.state))
    (snapshot : r.state.envWorld?=none ∨ r.state.worldMutatedSinceAdoption=true)
    (wf : StorageMap.WF r.state.storage) (f : Ref) (off : Nat) :
    f.get (adoptWorld w c r.state) off=f.get r.state off := by
  have self := snapshotWorld_find_self c r.state snapshot
  have h : selfStore c w=wordMapToStorage r.state.storage := by
    rw [reply]; unfold selfStore; rw [self]; rfl
  have storage : (adoptWorld w c r.state).storage=storageToWordMap (wordMapToStorage r.state.storage) :=
    congrArg storageToWordMap h
  have load (k : Source.Word) : (adoptWorld w c r.state).loadSlot k=Shared.norm (r.state.loadSlot k) := by
    unfold State.loadSlot
    rw [storage,lookup?_roundtrip _ wf]
    cases StorageMap.lookup? r.state.storage k <;> rfl
  unfold Ref.get amountAt; rw [load]
  simp [wordBitRange,Shared.norm,Nat.mod_mod]

theorem recordPreservesValue (r : Runtime) (call : ExternalInteraction) (f : Ref) (off : Nat) :
    f.get (r.recordExternalInteraction call).state off=f.get r.state off := rfl

end Inv12
