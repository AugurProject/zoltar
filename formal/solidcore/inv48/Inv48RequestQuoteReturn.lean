import Inv48RequestQuoteWire
import Inv48EscrowJoinCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestQuote
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- An actual successful callee transcript, rather than a pure callee-output
assumption, reaches the reference-aware caller return assignment unchanged. -/
theorem successfulReturn (fn : InternalFunction) (saved : LocalEnv) (r next : Runtime)
    (id : Nat) (returned : List Value) (target : String)
    (tree : SolI Result) (trace : Interaction.Transcript)
    (run : ExecutesOK tree trace (.returned r returned))
    (coerce : (if returned.isEmpty then collectReturnBindingsRef fn.returns r
      else coerceReturnBindingsRef fn.returns r returned) = .ok [.memoryRef id])
    (write : ({r with locals := saved}).assignNamedValuesRef? [target] [.memoryRef id] = some next) :
    ExecutesOK (tree >>= internalCallFinish fn [target] saved) trace (.normal next) := by
  have finish := quoteReturn fn saved r next id returned target coerce write
  have done : ExecutesOK (internalCallFinish fn [target] saved (.returned r returned)) [] (.normal next) := by
    rw [finish]
    exact .done _
  simpa only [List.append_nil] using Interaction.Executes.bind_ok run done

theorem quoteAlias (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (id : Nat)
    (ty : Ty) (ref : r.lookupLocal? "_sol_hoist_0" = some (.memoryRef id)) :
    Stmt.eval (n+1) t c r (.memoryVarDecl ty "quote" (some (.var "_sol_hoist_0"))) =
      pure (.normal (r.declareLocal "quote" (.memoryRef id))) := by
  have memory : r.lookupMemoryRef? "_sol_hoist_0" = some id := by
    simp [Runtime.lookupMemoryRef?,ref]
  simp [Stmt.eval,Expr.memoryRefOrValue,Expr.memoryRefOrValueFuel,Expr.orderFuel,memory,
    SolI.caught]
  rfl

theorem hoistAlias (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (old id : Nat)
    (target : r.lookupLocal? "_sol_hoist_0" = some (.memoryRef old))
    (source : r.lookupLocal? "_ret__quoteReportFunding_0" = some (.memoryRef id))
    (write : r.assignLocalRaw? "_sol_hoist_0" (.memoryRef id) = some next) :
    Stmt.eval (n+1) t c r (.assign (.var "_sol_hoist_0") (.var "_ret__quoteReportFunding_0")) =
      pure (.normal next) := by
  have T : r.lookupMemoryRef? "_sol_hoist_0" = some old := by
    simp [Runtime.lookupMemoryRef?,target]
  have S : r.lookupMemoryRef? "_ret__quoteReportFunding_0" = some id := by
    simp [Runtime.lookupMemoryRef?,source]
  rw [Stmt.eval]
  simp only [T,S,write]

/-- The generated internal-call prologue feeds an actual successful body trace
into the epilogue; no quote-body internals are specified here. -/
theorem internalRun (n : Nat) (t : FunctionTable) (c : Context)
    (caller callee returnedRuntime next : Runtime) (fn : InternalFunction)
    (saved : LocalEnv) (key : String) (exprs : List Expr) (input returned : List Value)
    (id : Nat) (target : String) (trace : Interaction.Transcript)
    (arguments : Expr.evalRefArgList c caller exprs = pure (input,caller))
    (lookup : t.lookup? key = some fn)
    (enter : internalCallEnter? fn input caller = some (callee,saved))
    (run : ExecutesOK (Stmt.eval n t {c with checked := true} callee fn.body)
      trace (.returned returnedRuntime returned))
    (coerce : (if returned.isEmpty then collectReturnBindingsRef fn.returns returnedRuntime
      else coerceReturnBindingsRef fn.returns returnedRuntime returned) = .ok [.memoryRef id])
    (write : ({returnedRuntime with locals := saved}).assignNamedValuesRef? [target] [.memoryRef id] = some next) :
    ExecutesOK (Stmt.eval (n+1) t c caller (.internalCall [target] key exprs)) trace (.normal next) := by
  have eq : Stmt.eval (n+1) t c caller (.internalCall [target] key exprs) =
      (Stmt.eval n t {c with checked := true} callee fn.body >>= internalCallFinish fn [target] saved) := by
    rw [Stmt.eval]
    dsimp only
    rw [arguments]
    change (match t.lookup? key with
      | none => pure (Result.reverted caller RevertData.typeMismatch)
      | some f => match internalCallEnter? f input caller with
        | none => pure (Result.reverted caller RevertData.typeMismatch)
        | some (i,s) => Stmt.eval n t {c with checked := true} i f.body >>=
            internalCallFinish f [target] s) = _
    simp only [lookup,enter]
  rw [eq]
  exact successfulReturn fn saved returnedRuntime next id returned target _ trace run coerce write

theorem captureNormal (n : Nat) (t : FunctionTable) (c : Context)
    (r next : Runtime) (stmt : Stmt) (targets : List String)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval n t c r stmt) trace (.normal next)) :
    ExecutesOK (Stmt.eval (n+1) t c r (.captureReturn targets stmt)) trace (.normal next) := by
  rw [Stmt.eval]
  dsimp only
  rw [← List.append_nil trace]
  exact Interaction.Executes.bind_ok run (.done _)

#print axioms captureNormal
#print axioms internalRun
#print axioms hoistAlias
#print axioms successfulReturn
#print axioms quoteAlias
end Inv48.RequestQuote
