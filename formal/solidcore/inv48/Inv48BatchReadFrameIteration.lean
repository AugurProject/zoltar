import Inv48BatchReadFrameWrite
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchReadFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.BatchInputLoop
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem requireRuntime (n : Nat) (t : FunctionTable) (c : Context)
    (e : Expr) (reason : Option String) (safe : Read e)
    (r final : Runtime) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n t c r (.requireStmt e reason))
      trace (.ok (.normal final))) : final = r := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    dsimp only at run
    obtain ⟨result,eq⟩ := frozen c r e safe
    cases result with
    | error err => rw [eq] at run; cases err <;> cases run
    | ok v =>
      have caught : (Expr.eval c r e).caught = pure (.ok (v,r)) := by rw [eq]; rfl
      rw [caught,pb] at run
      dsimp only at run
      cases value : v.expectWord with
      | error e => rw [value] at run; have h := pureResult _ _ _ run; cases h.2
      | ok w =>
        rw [value] at run
        dsimp only at run
        split at run
        · have h := pureResult _ _ _ run; cases h.2; rfl
        · cases reason <;> (have h := pureResult _ _ _ run; cases h.2)

theorem iterationShape : Inv48.OperationsWrapperArgs.loopIteration = .block [
    .requireStmt firstCondition (some "Operation gas zero"),
    .requireStmt secondCondition (some "Operation data too large"),
    .exprStmt (.assignment (some .add) (some (.uint 256)) (.var "requiredGas") bodyRhs)] := rfl

theorem iterationWrite (n : Nat) (c : Context) (r final : Runtime)
    (old : Nat) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopIteration) trace (.ok (.normal final))) :
    ∃ value, r.assignLocal? "requiredGas" value = some final := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [iterationShape] at run
    obtain ⟨inner,body,pop⟩ := blockNormal n _ c r final _ trace run
    obtain ⟨r1,t1,t2,_,first,rest⟩ := sequenceNormal n _ c r.pushScope inner _ _ trace body
    have eq1 := requireRuntime n _ c firstCondition _ firstRead _ _ _ first
    subst r1
    obtain ⟨r2,t3,t4,_,second,rest⟩ := sequenceNormal n _ c r.pushScope inner _ _ t2 rest
    have eq2 := requireRuntime n _ c secondCondition _ secondRead _ _ _ second
    subst r2
    obtain ⟨r3,t5,t6,_,assignment,last⟩ := sequenceNormal n _ c r.pushScope inner _ _ t4 rest
    rw [Stmt.evalList] at last
    have terminal := pureResult _ _ _ last
    cases terminal.2
    obtain ⟨value,write⟩ := assignmentWrite n c r.pushScope inner old t5 bound assignment
    obtain ⟨outer,write,shape⟩ := scalarPushWrite r inner "requiredGas" old value bound write
    rw [pop,shape]
    exact ⟨value,write⟩
theorem iterationInputs (n : Nat) (c : Context) (r final : Runtime)
    (p a b old : Nat) (batch : Value) (trace : Interaction.Transcript)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (inputs : Inputs r p a b batch)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopIteration) trace (.ok (.normal final))) :
    Inputs final p a b batch := by
  obtain ⟨value,write⟩ := iterationWrite n c r final old trace bound run
  exact writeInputs r final p a b old batch value "requiredGas" (Or.inr rfl) bound write inputs

/-- Successful iteration preserves every unrelated binding, including a scalar
index. This follows from the concrete write recovered from that execution. -/
theorem iterationLookup (n : Nat) (c : Context) (r final : Runtime)
    (old : Nat) (trace : Interaction.Transcript) (other : String)
    (bound : r.lookupLocal? "requiredGas" = some (.word old))
    (different : other ≠ "requiredGas")
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopIteration) trace (.ok (.normal final))) :
    final.lookupLocal? other = r.lookupLocal? other := by
  obtain ⟨value,write⟩ := iterationWrite n c r final old trace bound run
  exact scalarWrite r final "requiredGas" other old value bound different write
end Inv48.BatchReadFrame
