import Inv48LiquidationGuardLibraryCall
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The actual call entry shares all state with the argument-evaluation runtime. -/
theorem enteredState (s : LibraryEntered fuel c r final tr) : s.inner.state = s.mid.state := by
  obtain ⟨frame,_,inner,_⟩ := enteredFrame s
  rw [inner]

/-- Recover the real return coercion and caller restoration from the observed
finish slice. This does not assert that the library preserved global state. -/
private theorem finishAssignmentOf (fn : InternalFunction) (saved : LocalEnv)
    (result : Result) (trace : Interaction.Transcript) (final : Runtime)
    (run : Interaction.Executes (internalCallFinish fn [libraryRet] saved result)
      trace (.ok (.normal final))) :
    ∃ bodyRuntime values,
      (result = .normal bodyRuntime ∨ ∃ returned, result = .returned bodyRuntime returned) ∧
      Interaction.Executes
        (internalCallAssign {bodyRuntime with locals := saved} [libraryRet] values)
        trace (.ok (.normal final)) := by
  cases result with
  | normal bodyRuntime =>
    rw [internalCallFinish] at run
    cases collected : collectReturnBindingsRef fn.returns bodyRuntime with
    | error err => rw [collected] at run; cases run
    | ok values =>
      rw [collected] at run
      exact ⟨bodyRuntime,values,Or.inl rfl,run⟩
  | returned bodyRuntime returned =>
    rw [internalCallFinish] at run
    cases coerced : (if returned.isEmpty then collectReturnBindingsRef fn.returns bodyRuntime
      else coerceReturnBindingsRef fn.returns bodyRuntime returned) with
    | error err => rw [coerced] at run; cases run
    | ok values =>
      rw [coerced] at run
      exact ⟨bodyRuntime,values,Or.inr ⟨returned,rfl⟩,run⟩
  | _ => rw [internalCallFinish] at run; cases run

theorem finishAssignment (s : LibraryEntered fuel c r final tr) :
    ∃ bodyRuntime values,
      (s.result = .normal bodyRuntime ∨ ∃ returned, s.result = .returned bodyRuntime returned) ∧
      Interaction.Executes
        (internalCallAssign {bodyRuntime with locals := s.saved} [libraryRet] values)
        s.finishTrace (.ok (.normal final)) :=
  finishAssignmentOf s.fn s.saved s.result s.finishTrace final s.finishRun
#print axioms enteredState
#print axioms finishAssignment
end GuardRecovery
