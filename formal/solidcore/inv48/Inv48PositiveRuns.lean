import Inv48PositiveSyntax
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PositiveRuns

theorem bind {α β : Type} (rows : ScriptedResponder) (step : SolI α) (k : α → SolI β) :
    (step >>= k).runWith rows = (step.runWith rows >>= fun v => (k v).runWith rows) := by
  induction step with
  | done result => cases result <;> rfl
  | request query cont ih =>
    cases query with
    | resource resource => exact ih _
    | external world req =>
      cases req with
      | call request =>
        simp only [Bind.bind,Interaction.bind,SolI.runWith]
        cases hit : rows.answerCall? world request with
        | some answer => exact ih _
        | none =>
          cases pre : precompileAnswerCall? world request with
          | some answer => exact ih _
          | none => rfl
      | create request =>
        simp only [Bind.bind,Interaction.bind,SolI.runWith]
        cases hit : rows.answerCreate? world request with
        | some answer => exact ih _
        | none => rfl

theorem seq (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (rows : ScriptedResponder) (stmt : Stmt) (tail : List Stmt)
    (ok : (Stmt.eval n t c r stmt).runWith rows=.ok (.normal next)) :
    (Stmt.evalList n t c r (stmt::tail)).runWith rows=(Stmt.evalList n t c next tail).runWith rows := by
  rw [Stmt.evalList,bind,ok];rfl

theorem blockResult (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (rows : ScriptedResponder) (ss : List Stmt) (result : Result)
    (ok : (Stmt.evalList n t c r.pushScope ss).runWith rows=.ok result) :
    (Stmt.eval (n+1) t c r (.block ss)).runWith rows=.ok (result.mapRuntime Runtime.popScope) := by
  rw [Stmt.eval,bind,ok];rfl

theorem capture (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (rows : ScriptedResponder) (names : List String) (stmt : Stmt)
    (ok : (Stmt.eval n t c r stmt).runWith rows=.ok (.normal next)) :
    (Stmt.eval (n+1) t c r (.captureReturn names stmt)).runWith rows=.ok (.normal next) := by
  rw [Stmt.eval,bind,ok];rfl

theorem stop (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (rows : ScriptedResponder) (stmt : Stmt) (tail : List Stmt) (values : List Value)
    (ok : (Stmt.eval n t c r stmt).runWith rows=.ok (.returned next values)) :
    (Stmt.evalList n t c r (stmt::tail)).runWith rows=.ok (.returned next values) := by
  rw [Stmt.evalList,bind,ok];rfl
end Inv48.PositiveRuns
