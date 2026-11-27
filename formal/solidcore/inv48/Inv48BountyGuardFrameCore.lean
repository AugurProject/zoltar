import Inv48GuardArgsFramePrefix
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BountyGuardFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def ret := "_ret__minimumSettlementBounty_0"
def key := "__internal__minimumSettlementBounty(uint256)#[SolidCore.Solidity.Ty.uint 256]"

theorem assignHead (r final : Runtime) (name : String) (f : Frame) (tail : LocalEnv)
    (shape : r.locals = ((name,.word 0)::f)::tail) (values : List Value)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (internalCallAssign r [name] values) trace (.normal final)) :
    ∃ v, final.locals = ((name,v)::f)::tail := by
  unfold internalCallAssign at run
  simp only [List.isEmpty_cons, Bool.false_eq_true, ↓reduceIte] at run
  split at run
  · rename_i updated assigned
    have h := pureResult _ _ _ run
    cases h.2
    cases values with
    | nil => simp [Runtime.assignNamedValuesRef?] at assigned
    | cons v vs =>
      simp only [Runtime.assignNamedValuesRef?] at assigned
      cases v <;> simp only [Runtime.assignLocalRefAware?,Runtime.assignStorageRefValue?,
        Runtime.assignLocal?,Runtime.lookupLocal?,shape,LocalEnv.lookup?,Frame.lookup?,
        ↓reduceIte] at assigned
      all_goals try { contradiction }
      all_goals
        split at assigned
        · rename_i mid localAssigned
          split at localAssigned
          · simp only [shape,LocalEnv.assign?,Frame.assign?,↓reduceIte] at localAssigned
            cases localAssigned
            cases vs <;> simp only [Runtime.assignNamedValuesRef?] at assigned
            all_goals cases assigned
            exact ⟨_,rfl⟩
          · contradiction
        · simp at assigned
  · have h := pureResult _ _ _ run; cases h.2

theorem finishHead (fn : InternalFunction) (out : Result) (saved : LocalEnv)
    (f : Frame) (tail : LocalEnv) (shape : saved = ((ret,.word 0)::f)::tail)
    (final : Runtime) (trace : Interaction.Transcript)
    (run : ExecutesOK (internalCallFinish fn [ret] saved out >>= captureNext [ret]) trace (.normal final)) :
    ∃ v, final.locals = ((ret,v)::f)::tail := by
  cases out <;> simp only [internalCallFinish] at run
  all_goals try { change ExecutesOK (pure _) _ _ at run; have h := pureResult _ _ _ run; cases h.2 }
  all_goals
    split at run
    · rename_i vals hv
      have go (r : Runtime) :
          ExecutesOK (internalCallAssign {r with locals := saved} [ret] vals >>= captureNext [ret]) trace (.normal final) →
          ∃ v, final.locals = ((ret,v)::f)::tail := by
        intro hrun
        obtain ⟨result,bt,aft,_,first,last⟩ := bindSuccessful _ _ _ _ hrun
        cases result with
        | normal r' =>
          change ExecutesOK (pure (Result.normal r')) aft (Result.normal final) at last
          have h := pureResult _ _ _ last
          cases h.2
          exact assignHead _ _ ret f tail shape vals bt first
        | returned r' vs =>
          unfold internalCallAssign at first
          simp only [List.isEmpty_cons, Bool.false_eq_true, ↓reduceIte] at first
          split at first <;> (have h := pureResult _ _ _ first; cases h.2)
        | constructorReturned r' bytes | selfdestructed r' | reverted r' e | broke r' | continued r' =>
          change ExecutesOK (pure _) aft (Result.normal final) at last
          have h := pureResult _ _ _ last
          cases h.2
      exact go _ run
    · change ExecutesOK (pure _) _ _ at run
      have h := pureResult _ _ _ run
      cases h.2
end Inv48.BountyGuardFrame
