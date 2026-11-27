import Inv48FundingMinimumObservedFunding
import Inv48QuoteMinimumObservedSyntax
open SolidCore.Solidity.Source
namespace Inv48.ObservedMinimumGuard
open Inv48.QuoteMinimumJoin
open Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem internalGetter (fuel : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (p m : Nat) (final : Runtime) (target : String) (args : List Expr)
    (arguments : Expr.evalRefArgList c r args = pure ([.word p],r))
    (bodyRun : (Stmt.eval fuel Inv48.Source.model.core.table {c with checked := true}
      (start {r with locals := []} p) Inv48.Public.body).runWith rows =
      .ok (.returned final [.word m])) :
    (Stmt.eval (fuel+1) Inv48.Source.model.core.table c r
      (.internalCall [target] key args)).runWith rows =
      (internalCallAssign {final with locals := r.locals} [target]
        [.word (m)]).runWith rows := by
  obtain ⟨fn,found,params,returns,body⟩ := getterBinding
  have enter : internalCallEnter? fn [.word p] r = some (start {r with locals := []} p,r.locals) := by
    simp [internalCallEnter?,InternalFunction.initialFrame?,params,returns,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,
      BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,Ty.defaultValue,start,Runtime.withFrame]
  have call := Inv48.Minima.callRun (fuel) Inv48.Source.model.core.table c r r (start {r with locals := []} p)
    rows key fn args [.word p] [target] r.locals _ arguments found enter (by rw [body]; exact bodyRun)
  rw [call]
  simp [internalCallFinish,returns,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,start,
    Runtime.withFrame,Bind.bind,Except.bind]

#print axioms internalGetter
end Inv48.ObservedMinimumGuard
