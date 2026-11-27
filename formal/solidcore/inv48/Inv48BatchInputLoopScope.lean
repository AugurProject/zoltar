import Inv48BatchInputLoopAssignment
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BatchInputLoop
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

/-- A scalar write under a fresh iteration scope cannot populate that scope.
The successful outer write is recovered, rather than assumed. -/
theorem scalarPushWrite (r final : Runtime) (name : String) (old : Nat) (value : Value)
    (bound : r.lookupLocal? name = some (.word old))
    (write : r.pushScope.assignLocal? name value = some final) :
    ∃ outer, r.assignLocal? name value = some outer ∧ final = outer.pushScope := by
  have pushed : r.pushScope.lookupLocal? name = some (.word old) := bound
  simp only [Runtime.assignLocal?,pushed] at write
  cases coerce : (Value.word old).coerceLike? value with
  | none => simp [coerce] at write
  | some v =>
    simp only [coerce,Runtime.pushScope,LocalEnv.assign?,Frame.assign?] at write
    cases assigned : LocalEnv.assign? r.locals name v with
    | none => simp [assigned] at write
    | some locals =>
      simp only [assigned,Option.some.injEq] at write
      cases write
      refine ⟨{r with locals := locals},?_,rfl⟩
      simp only [Runtime.assignLocal?,bound,coerce,assigned]

theorem popPushInputs (r : Runtime) (p a b : Nat) (batch : Value) :
    Inputs r.pushScope.popScope p a b batch ↔ Inputs r p a b batch := by
  rfl

end Inv48.BatchInputLoop
