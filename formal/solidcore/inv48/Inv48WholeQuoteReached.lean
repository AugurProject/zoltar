import Inv48WholeQuoteJoin
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
abbrev Reached (program : SolI Result) (trace : Interaction.Transcript) (r : Runtime) :=
  Interaction.Executes program trace (.ok (.normal r))

theorem reachedPure (r : Runtime) : Reached (pure (.normal r)) [] r := .done _

theorem singleList (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (stmt : Stmt) :
    Stmt.evalList fuel t c r [stmt] = Stmt.eval fuel t c r stmt := by
  rw [Stmt.evalList]
  change Interaction.bind _ _ = _
  have continuation : (fun result : Result => match result with
      | .normal mid => Stmt.evalList fuel t c mid []
      | out => pure out) = (fun out => pure out) := by
    funext out; cases out <;> simp only [Stmt.evalList]
  exact (congrArg (fun k : Result → SolI Result => Interaction.bind (Stmt.eval fuel t c r stmt) k) continuation).trans
    (Interaction.bind_pure _)

theorem reachedAppend (fuel : Nat) (t : FunctionTable) (c : Context) (r mid out : Runtime)
    (xs ys : List Stmt) (first rest : Interaction.Transcript)
    (A : Reached (Stmt.evalList fuel t c r xs) first mid)
    (B : Reached (Stmt.evalList fuel t c mid ys) rest out) :
    Reached (Stmt.evalList fuel t c r (xs++ys)) (first++rest) out := by
  rw [listAppend]
  exact Interaction.Executes.bind_ok A B

theorem reachedBlock (fuel : Nat) (t : FunctionTable) (c : Context) (r out : Runtime)
    (xs : List Stmt) (trace : Interaction.Transcript)
    (run : Reached (Stmt.evalList fuel t c r.pushScope xs) trace out) :
    Reached (Stmt.eval (fuel+1) t c r (.block xs)) trace out.popScope := by
  rw [Stmt.eval]
  have result := Interaction.Executes.bind_ok (next := fun result : Result => pure (result.mapRuntime Runtime.popScope)) run
    (show Reached (pure (.normal out.popScope)) [] out.popScope from reachedPure _)
  simpa only [List.append_nil] using result

structure ReachedOracleObservation (fuel : Nat) (t : FunctionTable) (c : Context)
    (before after : Runtime) (code : List Stmt) (trace : Interaction.Transcript) where
  execution : Reached (Stmt.evalList fuel t c before code) trace after
  memory : after.memory = before.memory
  quote : after.lookupLocal? "quote" = before.lookupLocal? "quote"

theorem reachedOracleMemory {id : Nat} {v : Value}
    (obs : ReachedOracleObservation fuel t c before after code trace)
    (mem : before.loadMemory? id = some v) : after.loadMemory? id = some v := by
  simpa [Runtime.loadMemory?,obs.memory] using mem

#print axioms reachedAppend
#print axioms reachedBlock
end Inv48.WholeQuote
