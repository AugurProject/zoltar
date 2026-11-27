import Inv48ReportingGuardFrameCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ReportingGuardFrame
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem scalarAssign (r : Runtime) (name : String) (old : Nat) (tail : Frame) (rest : LocalEnv)
    (shape : r.locals = ((name,.word old)::tail)::rest) (values : List Value)
    (final : Runtime)
    (run : ExecutesOK (internalCallAssign r [name] values) [] (.normal final)) :
    ∃ value, final.locals = ((name,value)::tail)::rest := by
  unfold internalCallAssign at run
  simp only [List.isEmpty_cons,Bool.false_eq_true,if_false] at run
  split at run
  next updated assigned =>
    have h := pureResult _ _ _ run
    cases h.2
    cases values with
    | nil => simp [Runtime.assignNamedValuesRef?] at assigned
    | cons v vs =>
      simp only [Runtime.assignNamedValuesRef?] at assigned
      cases v <;> simp only [Runtime.assignLocalRefAware?,Runtime.assignStorageRefValue?,
        Runtime.assignLocal?,Runtime.lookupLocal?,shape,LocalEnv.lookup?,Frame.lookup?,
        if_true] at assigned
      all_goals try { contradiction }
      all_goals
        split at assigned
        next updated hlocal =>
          cases vs <;> simp only [Runtime.assignNamedValuesRef?] at assigned
          all_goals cases assigned
          split at hlocal
          next coerced hcoerce =>
            simp only [LocalEnv.assign?,Frame.assign?,if_true] at hlocal
            cases hlocal
            exact ⟨_,rfl⟩
          next bad => contradiction
        next bad => simp at assigned

  next bad => have h := pureResult _ _ _ run; cases h.2

theorem universeCapture (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (tail : Frame) (rest : LocalEnv) (old : Nat)
    (shape : r.locals = (("_ret_universeId_0",.word old)::tail)::rest)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+2) t c r
      (.captureReturn ["_ret_universeId_0"]
        (.internalCall ["_ret_universeId_0"] "__internal_universeId()#[]" [])))
      trace (.normal final)) :
    ∃ value, final.locals = (("_ret_universeId_0",value)::tail)::rest := by
  obtain ⟨post,values,assigned⟩ := capturedNoArgs n t c r final _ _ trace run
  exact scalarAssign {post with locals := r.locals} _ old tail rest shape values final assigned

end Inv48.ReportingGuardFrame
