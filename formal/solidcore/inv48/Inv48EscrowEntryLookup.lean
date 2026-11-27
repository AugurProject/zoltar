import Inv48EscrowJoinGenerated
import Inv48EscrowJoinBoundary
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- An explicit response of the actual lookup body, rather than a live-local
assumption or an equation replacing the lookup by a pure call. -/
def LookupResponse (fuel : Nat) (t : FunctionTable) (c : Context)
    (fn : InternalFunction) (caller response : Runtime) (rep : Nat)
    (trace : Interaction.Transcript) : Prop :=
  ∃ inner, internalCallEnter? fn [] caller = some (inner,caller.locals) ∧
    ExecutesOK (Stmt.eval fuel t {c with checked := true} inner fn.body)
      trace (.returned response [.word rep])

/-- The framed call consumes the explicit body response and restores the saved
caller frame before assigning the returned token. The return coercion and
reference-aware write are the real interpreter operations. -/
theorem lookupResponseCall (fuel : Nat) (t : FunctionTable) (c : Context)
    (caller response final : Runtime) (fn : InternalFunction) (key target : String)
    (rep : Nat) (trace : Interaction.Transcript)
    (found : t.lookup? key = some fn)
    (lookup : LookupResponse fuel t c fn caller response rep trace)
    (coerce : coerceReturnBindingsRef fn.returns response [.word rep] = .ok [.word rep])
    (write : ({response with locals := caller.locals} : Runtime).assignNamedValuesRef?
      [target] [.word rep] = some final) :
    ExecutesOK (Stmt.eval (fuel+1) t c caller (.internalCall [target] key []))
      trace (.normal final) := by
  obtain ⟨inner,enter,body⟩ := lookup
  rw [Stmt.eval]
  dsimp only
  have args : Expr.evalRefArgList c caller [] = pure ([],caller) := by
    rfl
  rw [args]
  change ExecutesOK (match t.lookup? key with
    | none => pure (.reverted caller .typeMismatch)
    | some f => match internalCallEnter? f [] caller with
      | none => pure (.reverted caller .typeMismatch)
      | some (i,s) => Stmt.eval fuel t {c with checked := true} i f.body >>=
          internalCallFinish f [target] s) trace (.normal final)
  simp only [found,enter]
  have finish : internalCallFinish fn [target] caller.locals
      (.returned response [.word rep]) = pure (.normal final) := by
    simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,↓reduceIte,coerce,
      internalCallAssign,write]
  have cont : ExecutesOK (internalCallFinish fn [target] caller.locals
      (.returned response [.word rep])) [] (.normal final) := by
    rw [finish]
    exact .done _
  simpa only [List.append_nil] using Interaction.Executes.bind_ok body cont

#print axioms lookupResponseCall
end Inv48.EscrowEntry
