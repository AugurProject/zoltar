import Inv48BatchLoopClosureMetadata
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchLoopClosure
open Inv48.BatchInputLoop
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem actualParameters (fn : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some fn) :
    fn.params = Inv48.WrapperArgs.params ++ [batchDecl fn] ∧ (batchDecl fn).name = "batch" := by
  have h := checkedMetadata
  simp only [metadataCheck,found,Option.any_some,beq_iff_eq] at h
  have paramsEq := Inv48.WrapperArgs.parameterPrefix "requestSecurityPoolPriceWithOperations" fn
    (by decide) found
  cases rest : fn.params.drop 3 with
  | nil => simp [rest] at h
  | cons head tail =>
    cases tail with
    | cons next more => simp [rest] at h
    | nil =>
      have shape : fn.params = Inv48.WrapperArgs.params ++ [head] := by simpa [rest] using paramsEq
      have eq : batchDecl fn = head := by simp [batchDecl,shape,Inv48.WrapperArgs.params]
      constructor
      · simpa [eq] using shape
      · simpa [rest,eq] using h

/-- The batch value is the successful binder's result, retaining lazy/reference
representation. No batch materialization or element witnesses are assumed. -/
theorem initialFrameInputs (fn : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some fn)
    (p a b : Nat) (rawBatch : Value) (frame : Frame)
    (framed : fn.initialFrame? [.word p,.word a,.word b,rawBatch] = some frame) :
    ∃ batch, (batchDecl fn).ty.coerceValue? rawBatch = some batch ∧
      ∀ r : Runtime, Inputs {r with locals := [frame]} p a b batch := by
  obtain ⟨metadata,name⟩ := actualParameters fn found
  simp only [FunctionDef.initialFrame?,metadata,Inv48.WrapperArgs.params,
    List.cons_append,List.nil_append,BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?] at framed
  cases bound : (batchDecl fn).ty.coerceValue? rawBatch with
  | none => simp [bound] at framed
  | some batch =>
    simp only [bound] at framed
    cases framed
    refine ⟨batch,rfl,?_⟩
    intro r
    simp [Inputs,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,name]

/-- Initialization of requiredGas is executable, and establishes the only
scalar premise required by the complete successful validation theorem. -/
theorem initializedGasInputs (n : Nat) (c : Context) (r final : Runtime)
    (p a b : Nat) (batch : Value) (trace : Interaction.Transcript)
    (inputs : Inputs r p a b batch)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c
      (r.declareLocal "requiredGas" (.word 0)) Inv48.OperationsWrapperArgs.loopP.value)
      trace (.ok (.normal final))) : Inputs final p a b batch := by
  apply validationInputs n c _ final p a b 0 batch trace _ (by simp) run
  simpa [Inputs] using inputs
/-- From the actual wrapper's successfully bound four-argument frame to the
completed validation block, with every original input lookup derived. -/
theorem boundValidationInputs (fn : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some fn)
    (p a b : Nat) (rawBatch : Value) (frame : Frame)
    (framed : fn.initialFrame? [.word p,.word a,.word b,rawBatch] = some frame)
    (n : Nat) (c : Context) (r final : Runtime) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c
      ({r with locals := [frame]}.declareLocal "requiredGas" (.word 0))
      Inv48.OperationsWrapperArgs.loopP.value) trace (.ok (.normal final))) :
    ∃ batch, (batchDecl fn).ty.coerceValue? rawBatch = some batch ∧ Inputs final p a b batch := by
  obtain ⟨batch,bound,inputs⟩ := initialFrameInputs fn found p a b rawBatch frame framed
  exact ⟨batch,bound,initializedGasInputs n c {r with locals := [frame]} final
    p a b batch trace (inputs r) run⟩

end Inv48.BatchLoopClosure
