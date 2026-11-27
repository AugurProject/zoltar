import Inv48EscrowPrefix
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- A successful address slot bounds the normalized word, rather than an
    arbitrary unnormalized host natural. -/
theorem encodedAddressCanonical (word : Nat) (bytes : List Byte)
    (encoded : abiStaticBytes? .address (.word word) = some bytes) :
    SolidCore.Solidity.Shared.norm word < 2^160 := by
  simp only [abiStaticBytes?] at encoded
  split at encoded
  next fits => exact of_decide_eq_true fits
  next bad => contradiction

/-- If the word is already canonical as a uint256 (as a decoded creation
    response is), address encoding bounds the word itself. -/
theorem encodedCanonicalWordAddress (word : Nat) (bytes : List Byte)
    (canonical : SolidCore.Solidity.Shared.norm word = word)
    (encoded : abiStaticBytes? .address (.word word) = some bytes) :
    word < 2^160 := by
  simpa only [canonical] using encodedAddressCanonical word bytes encoded

/-- Invert a normal sequential prelude, excluding all early non-normal exits. -/
theorem sequenceNormal (fuel : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (s : Stmt) (ss : List Stmt) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList fuel t c r (s::ss)) trace (.normal final)) :
    ∃ middle before after, trace = before ++ after ∧
      ExecutesOK (Stmt.eval fuel t c r s) before (.normal middle) ∧
      ExecutesOK (Stmt.evalList fuel t c middle ss) after (.normal final) := by
  rw [Stmt.evalList] at run
  obtain ⟨out,before,after,joined,first,last⟩ := bindSuccessful _ _ _ _ run
  cases out with
  | normal middle => exact ⟨middle,before,after,joined,first,last⟩
  | returned r values | constructorReturned r bytes | selfdestructed r | reverted r err | broke r | continued r =>
    have h := pureResult _ _ _ last
    cases h.2

/-- A block's normal result is a scope-pop of its actual normal inner result. -/
theorem blockNormal (fuel : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (ss : List Stmt) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (fuel+1) t c r (.block ss)) trace (.normal final)) :
    ∃ inner, ExecutesOK (Stmt.evalList fuel t c r.pushScope ss) trace (.normal inner) ∧
      final = inner.popScope := by
  rw [Stmt.eval] at run
  obtain ⟨out,before,after,joined,body,last⟩ := bindSuccessful _ _ _ _ run
  have h := pureResult _ _ _ last
  cases out <;> simp only [Result.mapRuntime] at h
  all_goals try { cases h.2 }
  case normal inner =>
    cases h.2
    have eq : trace = before := by simpa only [h.1,List.append_nil] using joined
    exact ⟨inner,eq.symm ▸ body,rfl⟩

/-- Successful caught expressions have exactly the original open transcript. -/
theorem caughtSuccessful {α : Type} (tree : SolI α) (trace : Interaction.Transcript)
    (value : α) (run : ExecutesOK tree.caught trace (.ok value)) :
    ExecutesOK tree trace value := by
  induction tree generalizing trace with
  | done result =>
    cases result with
    | ok a =>
      have h := pureResult _ _ _ run
      cases h.2
      cases h.1
      exact .done _
    | error err =>
      cases err <;> cases run
  | request query resume ih =>
    cases run with
    | request answer tail => exact .request answer (ih answer _ tail)

#print axioms caughtSuccessful
theorem appendNormal (fuel : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (prelude suffix : List Stmt) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList fuel t c r (prelude ++ suffix)) trace (.normal final)) :
    ∃ ready before after, trace = before ++ after ∧
      ExecutesOK (Stmt.evalList fuel t c r prelude) before (.normal ready) ∧
      ExecutesOK (Stmt.evalList fuel t c ready suffix) after (.normal final) := by
  induction prelude generalizing r trace with
  | nil =>
    exact ⟨r,[],trace,rfl,by rw [Stmt.evalList]; exact .done _,run⟩
  | cons s ss ih =>
    obtain ⟨middle,first,tail,joined,step,rest⟩ := sequenceNormal fuel t c r final s
      (ss ++ suffix) trace run
    obtain ⟨ready,before,after,split,pre,post⟩ := ih middle tail rest
    refine ⟨ready,first ++ before,after,?_,?_,post⟩
    · rw [joined,split,List.append_assoc]
    · rw [Stmt.evalList]
      exact Interaction.Executes.bind_ok step pre

#print axioms appendNormal
#print axioms encodedAddressCanonical
#print axioms encodedCanonicalWordAddress
#print axioms sequenceNormal
#print axioms blockNormal
end Inv48.EscrowJoin
