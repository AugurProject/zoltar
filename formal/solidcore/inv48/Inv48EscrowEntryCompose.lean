import Inv48EscrowEntryPrepare
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

theorem appendExecution (fuel : Nat) (t : FunctionTable) (c : Context)
    (r ready final : Runtime) (pre suffix : List Stmt)
    (before after : Interaction.Transcript)
    (preRun : ExecutesOK (Stmt.evalList fuel t c r pre) before (.normal ready))
    (rest : ExecutesOK (Stmt.evalList fuel t c ready suffix) after (.normal final)) :
    ExecutesOK (Stmt.evalList fuel t c r (pre ++ suffix)) (before ++ after) (.normal final) := by
  induction pre generalizing r before with
  | nil =>
    rw [Stmt.evalList] at preRun
    obtain ⟨tr,val⟩ := pureResult _ _ _ preRun
    cases val
    cases tr
    exact rest
  | cons s ss ih =>
    obtain ⟨middle,first,tail,joined,step,more⟩ := sequenceNormal _ _ _ _ _ _ _ _ preRun
    have remaining := ih middle tail more
    rw [List.cons_append,Stmt.evalList]
    rw [joined,List.append_assoc]
    exact Interaction.Executes.bind_ok (next := fun out => match out with
      | .normal rr => Stmt.evalList fuel t c rr (ss ++ suffix)
      | out => pure out) step remaining

theorem blockExecution (fuel : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (ss : List Stmt) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList fuel t c r.pushScope ss) trace (.normal final)) :
    ExecutesOK (Stmt.eval (fuel+1) t c r (.block ss)) trace (.normal final.popScope) := by
  rw [Stmt.eval]
  simpa only [List.append_nil] using Interaction.Executes.bind_ok
    (next := fun out => pure (out.mapRuntime Runtime.popScope)) run
    (show ExecutesOK (pure (Result.normal final.popScope)) [] (.normal final.popScope) from .done _)

#print axioms appendExecution
#print axioms blockExecution
end Inv48.EscrowEntry
