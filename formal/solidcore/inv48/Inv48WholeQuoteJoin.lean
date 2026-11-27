import Inv48WholeQuoteCore
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
open QuoteMemory
open EvmCompiler.Simulation

private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl

theorem listAppend (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (xs ys : List Stmt) :
    Stmt.evalList fuel t c r (xs++ys) =
      (Stmt.evalList fuel t c r xs >>= fun
        | .normal mid => Stmt.evalList fuel t c mid ys
        | out => pure out) := by
  induction xs generalizing r with
  | nil => simp only [List.nil_append,Stmt.evalList]; rw [pb]
  | cons x xs ih =>
    simp only [List.cons_append,Stmt.evalList]
    change _ = Interaction.bind (Interaction.bind _ _) _
    rw [Interaction.bind_assoc]
    congr 1
    funext out
    cases out <;> try rfl
    exact ih _

theorem appendNormal (fuel : Nat) (t : FunctionTable) (c : Context) (r mid : Runtime)
    (xs ys : List Stmt)
    (step : Stmt.evalList fuel t c r xs = pure (.normal mid)) :
    Stmt.evalList fuel t c r (xs++ys) = Stmt.evalList fuel t c mid ys := by
  rw [listAppend,step]; rfl

def floorCode (i : Nat) (x y d : Expr) : List Stmt := [
  .varDecl .uint256 Inv32CeilFlags.h0 none,
  Inv32FloorHoist.code Inv32CeilFlags.h0 x y d,
  .assign (.index (.var "quote") (.word i))
    (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var Inv32CeilFlags.h0)))]

def funded (r : Runtime) (id a p : Nat) :=
  put (Inv32OneArg.store (put r id a 0 0 0 0) Inv32CeilFlags.h0
    (QuoteExec.repAmount a p)) id a (QuoteExec.repAmount a p) 0 0 0

def halted (r : Runtime) (id a p h : Nat) :=
  put (Inv32OneArg.store (funded r id a p) Inv32CeilFlags.h0 h)
    id a (QuoteExec.repAmount a p) h 0 0

theorem store_other (r : Runtime) (v : Nat) (name : String)
    (ne : name ≠ Inv32CeilFlags.h0) :
    (Inv32OneArg.store r Inv32CeilFlags.h0 v).lookupLocal? name = r.lookupLocal? name := by
  cases H : r.locals <;> simp [Inv32OneArg.store,Inv32CeilFlags.h0,Runtime.declareLocal,
    LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H,
    show "_sol_hoist_0" ≠ name from Ne.symm ne]

/-- The unresolved oracle stage is an execution observation plus a memory/local
frame, not an assumption about any funding field or the enclosing quote output. -/
structure OracleObservation (fuel : Nat) (t : FunctionTable) (c : Context)
    (before after : Runtime) (code : List Stmt) where
  execution : Stmt.evalList fuel t c before code = pure (.normal after)
  memory : after.memory = before.memory
  quote : after.lookupLocal? "quote" = before.lookupLocal? "quote"

/-- Frames alone recover the tuple after the oracle/exposure helper stage. -/
theorem oracle_memory {id : Nat} {v : Value} (obs : OracleObservation fuel t c before after code)
    (mem : before.loadMemory? id = some v) : after.loadMemory? id = some v := by
  simpa [Runtime.loadMemory?,obs.memory] using mem

#print axioms listAppend
#print axioms appendNormal
#print axioms oracle_memory
end Inv48.WholeQuote
