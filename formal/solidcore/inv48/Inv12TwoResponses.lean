import Inv12ResponseLedger
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

theorem secondSnapshot (c : Context) (r : Runtime) (w : Shared.OpenWorld) (i : ExternalInteraction) :
    snapshotWorld c (replied c r w i).state=w := by
  simp [replied,Runtime.recordExternalInteraction,adoptWorld,snapshotWorld]

theorem responsesPreserve (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (first second : EvmCompiler.Simulation.CallRequest) (one two : EvmCompiler.Simulation.CallResponse)
    (i j : ExternalInteraction) (noWrites : NoCoordinatorWrites rows)
    (a : rows.answerCall? (snapshotWorld c r.state) first=some one)
    (b : rows.answerCall? (snapshotWorld c (replied c r one.postWorld i).state) second=some two)
    (snap : r.state.envWorld?=none ∨ r.state.worldMutatedSinceAdoption=true) (wf : StorageMap.WF r.state.storage) :
    ∀ f off, Ref.get f (replied c (replied c r one.postWorld i) two.postWorld j).state off=f.get r.state off := by
  have firstStore := matchedReply c rows _ _ _ noWrites a
  rw [secondSnapshot] at b
  have stores := (matchedReply c rows _ _ _ noWrites b).trans firstStore
  intro f off
  exact afterResponse c r two.postWorld stores snap wf f off
end Inv12
