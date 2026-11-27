import Inv48BatchLoopClosureLoop
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchLoopClosure
open Inv48.BatchInputLoop Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.RequestGuards Inv48.RequestDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def initialized (r : Runtime) : Runtime :=
  r.pushScope.declareLocal "index" (.word 0)

theorem initializedInvariant (r : Runtime) (p a b g : Nat) (batch : Value)
    (inputs : Inputs r p a b batch)
    (gas : r.lookupLocal? "requiredGas" = some (.word g)) :
    Invariant (initialized r).pushScope p a b batch := by
  refine ⟨?_,⟨0,by simp [initialized]⟩,⟨g,by simpa [initialized] using gas⟩⟩
  intro k hk
  have casesK : k = 0 ∨ k = 1 ∨ k = 2 := by omega
  rcases casesK with rfl | rfl | rfl <;> simpa [initialized,Inputs,Runtime.pushScope,Runtime.declareLocal,
    Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using inputs

theorem scopedFor (n : Nat) (c : Context) (r final : Runtime)
    (p a b : Nat) (batch : Value) (trace : Interaction.Transcript)
    (start : Invariant r.pushScope p a b batch)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      (.forLoop .skip Inv48.OperationsWrapperArgs.loopCondition
        Inv48.OperationsWrapperArgs.loopPost Inv48.OperationsWrapperArgs.loopIteration))
      trace (.ok (.normal final))) :
    ∃ inner, Invariant inner p a b batch ∧ final = inner.popScope := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    dsimp only at run
    cases n with
    | zero => rw [Stmt.eval] at run; cases run
    | succ n =>
      rw [Stmt.eval] at run
      dsimp only at run
      rw [pb] at run
      obtain ⟨result,bt,ft,_,loop,last⟩ := bindSuccess _ _ _ _ run
      have terminal := pureResult _ _ _ last
      cases result <;> simp only [Result.mapRuntime] at terminal
      all_goals try {cases terminal.2}
      exact ⟨_,forSuccessful (n+1) c _ _ p a b batch bt start loop,
        Result.normal.inj terminal.2⟩

/-- The complete generated validation block, including the actual index
initializer, for-loop scope, iteration scopes, increment, and both final pops. -/
theorem validationInputs (n : Nat) (c : Context) (r final : Runtime)
    (p a b g : Nat) (batch : Value) (trace : Interaction.Transcript)
    (inputs : Inputs r p a b batch)
    (gas : r.lookupLocal? "requiredGas" = some (.word g))
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      Inv48.OperationsWrapperArgs.loopP.value) trace (.ok (.normal final))) :
    Inputs final p a b batch := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Inv48.OperationsWrapperArgs.actualLoopShape] at run
    obtain ⟨inner,body,pop⟩ := blockNormal n _ c r final _ trace run
    obtain ⟨mid,t1,t2,_,decl,rest⟩ := sequenceNormal n _ c r.pushScope inner _ _ trace body
    cases n with
    | zero => rw [Stmt.eval] at decl; cases decl
    | succ n =>
      have init := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r.pushScope
        "index" .uint256 (.word 0) 0 (by rfl) (by rfl)
      rw [init] at decl
      have d := pureResult _ _ _ decl
      cases d.2
      obtain ⟨last,t3,t4,_,loop,empty⟩ := sequenceNormal (n+1) _ c (initialized r) inner _ _ t2 rest
      rw [Stmt.evalList] at empty
      have e := pureResult _ _ _ empty
      cases e.2
      obtain ⟨endRuntime,inv,shape⟩ := scopedFor (n+1) c (initialized r) inner p a b batch t3
        (initializedInvariant r p a b g batch inputs gas) loop
      rw [pop,shape]
      simpa [Runtime.popScope,List.drop_drop] using inv.1 2 (by decide)
end Inv48.BatchLoopClosure
