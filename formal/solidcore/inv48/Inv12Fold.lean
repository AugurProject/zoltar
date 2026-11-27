import Inv12CallRun
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv12

theorem runWithBind {α β : Type} (rows : ScriptedResponder) (step : SolI α) (k : α → SolI β) :
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

theorem externalSeq (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (rows : ScriptedResponder) (stmt : Stmt) (tail : List Stmt)
    (ok : (Stmt.eval n t c r stmt).runWith rows=.ok (.normal next)) :
    (Stmt.evalList n t c r (stmt::tail)).runWith rows=(Stmt.evalList n t c next tail).runWith rows := by
  rw [Stmt.evalList,runWithBind,ok];rfl
end Inv12
