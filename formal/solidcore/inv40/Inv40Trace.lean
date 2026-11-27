import Inv32OneArg

open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv40

abbrev Trace := Interaction.Transcript
abbrev Yields (tree : SolI α) (events : Trace) (value : α) :=
  Interaction.Executes tree events (.ok value)

theorem finishTrace {tree : SolI α} {next : α → SolI β} (step : Yields tree events v)
    (finish : next v = pure w) : Yields (tree >>= next) events w := by
  have doneAt : Yields (next v) [] w := finish ▸ Interaction.Executes.done _
  simpa only [List.append_nil] using Interaction.Executes.bind_ok step doneAt

theorem blockTrace {t : FunctionTable} {c : Context} {r : Runtime} {s : List Stmt}
    (step : Yields (Stmt.evalList n t c r.pushScope s) events v) :
    Yields (Stmt.eval (n+1) t c r (.block s)) events (v.mapRuntime Runtime.popScope) := by
  rw [Stmt.eval]
  exact finishTrace step rfl

theorem stopTrace {t : FunctionTable} {c : Context} {r : Runtime} {s : Stmt}
    (step : Yields (Stmt.eval n t c r s) events (.returned out vs)) (rest : List Stmt) :
    Yields (Stmt.evalList n t c r (s::rest)) events (.returned out vs) := by
  rw [Stmt.evalList]
  exact finishTrace step rfl

theorem nextTrace {t : FunctionTable} {c : Context} {r : Runtime} {s : Stmt}
    (step : Yields (Stmt.eval n t c r s) events (.normal out))
    (finish : Stmt.evalList n t c out rest = pure result) :
    Yields (Stmt.evalList n t c r (s::rest)) events result := by
  rw [Stmt.evalList]
  apply finishTrace step
  exact finish

theorem pureHead {t : FunctionTable} {c : Context} {r : Runtime} {s : Stmt}
    (step : Stmt.eval n t c r s = pure (.normal next))
    (rest : Yields (Stmt.evalList n t c next tail) events v) :
    Yields (Stmt.evalList n t c r (s::tail)) events v := by
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ step]
  exact rest

end Inv40
