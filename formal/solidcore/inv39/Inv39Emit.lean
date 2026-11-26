import Inv39EventEffect
import Inv39EventLayout
open SolidCore.Solidity.Source
namespace Inv39
def event3Result (label : String) (c : Context) (r : Runtime) (src dst val : Nat) : Result :=
  match r.emitEvent c label [.word src,.word dst,.word val] with
  | .ok post => .normal post
  | .error err => .reverted r err
theorem emitThree (label fromName toName valueName : String) (topic : Nat) (c : Context) (t : FunctionTable) (r : Runtime) (n src dst val : Nat)
    (S : r.lookupLocal? fromName=some (.word src)) (D : r.lookupLocal? toName=some (.word dst))
    (V : r.lookupLocal? valueName=some (.word val)) (fields : c.eventDecl? label=some ⟨label,2,some topic,transferFields⟩) :
    Stmt.eval (n+1) t c r (.emitEvent label [.var fromName,.var toName,.var valueName]) =
      pure (event3Result label c r src dst val) := by
  rw [Stmt.eval]
  dsimp only
  rw [fields]
  have E := args3 c r toName fromName valueName dst src val D S V
  change (do
    match ← (Expr.evalList c r [.var toName,.var fromName,.var valueName]).caught with
    | .ok (vs,next) =>
      match next.materializeForValueUseList c ((List.range 3).filterMap fun i =>
        (([1,0,2].zip vs).find? (fun p => p.1 == i)).map Prod.snd) with
      | .ok vals =>
        match next.emitEvent c label vals with
        | .ok updated => pure (Result.normal updated)
        | .error err => pure (Result.reverted r err)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err) : SolI Result) = _
  rw [E]
  have mat : r.materializeForValueUseList c [.word src,.word dst,.word val] = .ok [.word src,.word dst,.word val] := by
    simp [Runtime.materializeForValueUseList,Runtime.materializeForValueUse,Runtime.materializeForValueUseFuel,Bind.bind,Except.bind]
  change (match r.materializeForValueUseList c [.word src,.word dst,.word val] with
    | .ok vals =>
      match r.emitEvent c label vals with
      | .ok updated => (pure (Result.normal updated) : SolI Result)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [mat]
  unfold event3Result
  dsimp only
  cases r.emitEvent c label [.word src,.word dst,.word val] <;> rfl
def eventResult (c : Context) (r : Runtime) (src dst val : Nat) : Result :=
  match r.emitEvent c "Transfer" [.word src,.word dst,.word val] with
  | .ok post => .normal post
  | .error err => .reverted r err
theorem emitTransfer (c : Context) (t : FunctionTable) (r : Runtime) (n src dst val : Nat)
    (S : r.lookupLocal? "from"=some (.word src)) (D : r.lookupLocal? "to"=some (.word dst))
    (V : r.lookupLocal? "value"=some (.word val)) (decls : c.eventDecls = model.core.context.eventDecls) :
    Stmt.eval (n+1) t c r (.emitEvent "Transfer" [.var "from",.var "to",.var "value"]) =
      pure (eventResult c r src dst val) := by
  obtain ⟨topic,lookup⟩ := transferEventDecl
  have fields : c.eventDecl? "Transfer" = some (transferDecl topic) := by
    change c.eventDecls.find? _ = _
    rw [decls]; exact lookup
  exact emitThree "Transfer" "from" "to" "value" topic c t r n src dst val S D V fields
end Inv39
