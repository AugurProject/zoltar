import Inv48MinimaExternal
import Inv32Internal
open SolidCore.Solidity.Source
namespace Inv48.Minima

theorem callRun (fuel : Nat) (t : FunctionTable) (c : Context) (r after inner : Runtime)
    (rows : ScriptedResponder) (key : String) (fn : InternalFunction)
    (args : List Expr) (values : List Value) (targets : List String) (saved : LocalEnv) (out : Result)
    (arguments : Expr.evalRefArgList c r args = pure (values,after))
    (found : t.lookup? key = some fn)
    (enter : internalCallEnter? fn values after = some (inner,saved))
    (body : (Stmt.eval fuel t {c with checked := true} inner fn.body).runWith rows = .ok out) :
    (Stmt.eval (fuel+1) t c r (.internalCall targets key args)).runWith rows =
      (internalCallFinish fn targets saved out).runWith rows := by
  rw [Stmt.eval]
  simp only [arguments]
  change (match t.lookup? key with
    | none => pure (Result.reverted after .typeMismatch)
    | some f => match internalCallEnter? f values after with
      | none => pure (Result.reverted after .typeMismatch)
      | some (i,s) => Stmt.eval fuel t {c with checked := true} i f.body >>= internalCallFinish f targets s).runWith rows = _
  simp only [found,enter]
  rw [Inv12.runWithBind,body]
  rfl
end Inv48.Minima
