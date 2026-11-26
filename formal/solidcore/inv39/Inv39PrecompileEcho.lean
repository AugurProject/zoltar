import SolidCore.Solidity.AdoptionLaws
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.PrecompileEcho

theorem answered (w : Shared.OpenWorld) (q : EvmCompiler.Simulation.CallRequest)
    (a : EvmCompiler.Simulation.CallResponse) (h : precompileAnswerCall? w q=some a) : a.postWorld=w := by
  unfold precompileAnswerCall? at h
  repeat
    first | (split at h <;> try contradiction)
  all_goals try split at h
  all_goals cases h <;> rfl

theorem resultState (c : Context) (s : State) (kind : Shared.Precompile.Kind) (input : List Source.Byte)
    (output : Option Source.Word) (after : State)
    (run : (emitPrecompileWord c s kind input).runWith []=.ok (output,after)) :
    after=adoptWorld (snapshotWorld c s) c s := by
  let world := snapshotWorld c s
  let q := buildCallRequest c .staticcall (Shared.Precompile.address kind) input 0 none
  have miss : ScriptedResponder.answerCall? [] world q=none := rfl
  unfold emitPrecompileWord emitLowLevelCall at run
  simp only [Bind.bind,EvmCompiler.Simulation.Interaction.bind,SolI.runWith] at run
  dsimp only [world,q] at miss
  rw [miss] at run
  cases h : precompileAnswerCall? world q with
  | none => dsimp only [world,q] at h;rw [h] at run;cases run
  | some a =>
    dsimp only [world,q] at h;rw [h] at run
    change Except.ok (_,adoptWorld a.postWorld c s) = (Except.ok (output,after) : Except ResponderFailure _) at run
    exact (congrArg Prod.snd (Except.ok.inj run)).symm.trans (congrArg (fun w => adoptWorld w c s) (answered _ _ _ h))

theorem slots (c : Context) (s : State) (kind : Shared.Precompile.Kind) (input : List Source.Byte)
    (output : Option Source.Word) (after : State)
    (run : (emitPrecompileWord c s kind input).runWith []=.ok (output,after))
    (fresh : s.envWorld?=none ∨ s.worldMutatedSinceAdoption=true)
    (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (slot : Source.Word) :
    after.loadSlot slot=Shared.norm (s.loadSlot slot) := by
  rw [resultState c s kind input output after run]
  exact (adoptWorld_echo_noop _ _ fresh wf tf).1 slot

end Inv39.PrecompileEcho
