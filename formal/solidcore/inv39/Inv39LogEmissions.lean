import Inv39LogInputs
import Inv39EmitSuccess
open SolidCore.Solidity.Source
namespace Inv39.SupplyEvents
theorem mintEmission (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (addr val : Nat)
    (A : r.lookupLocal? "account"=some (.word addr)) (V : r.lookupLocal? "valueAttoRep"=some (.word val))
    (storage : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Stmt.eval (n+1) t c r (.emitEvent "Mint" (args .mint)) =
      pure (match r.emitEvent c "Mint" (values .mint r.state addr val) with
        | .ok updated => Result.normal updated | .error err => Result.reverted r err) := by
  obtain ⟨topic,declEq⟩ := layout .mint
  have found : c.eventDecl? "Mint" = some (decl .mint topic) := by
    change c.eventDecls.find? _ = _
    rw [events]; exact declEq
  rw [Stmt.eval]
  dsimp only
  rw [found]
  change (do
    match ← (Expr.evalList c r (args .mint)).caught with
    | .ok (vs,next) =>
      match next.materializeForValueUseList c ((List.range 2).filterMap fun i =>
        (([0,1].zip vs).find? (fun p => p.1 == i)).map Prod.snd) with
      | .ok vals =>
        match next.emitEvent c "Mint" vals with
        | .ok updated => pure (Result.normal updated)
        | .error err => pure (Result.reverted r err)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err) : SolI Result) = _
  rw [logArgs _ _ _ _ _ storage A V]
  have mat : r.materializeForValueUseList c [.word addr,.word val] = .ok [.word addr,.word val] := by
    simp [Runtime.materializeForValueUseList,Runtime.materializeForValueUse,Runtime.materializeForValueUseFuel,Bind.bind,Except.bind]
  change (match r.materializeForValueUseList c [.word addr,.word val] with
    | .ok vals =>
      match r.emitEvent c "Mint" vals with
      | .ok updated => (pure (Result.normal updated) : SolI Result)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [mat]
  dsimp only
  change (match r.emitEvent c "Mint" [.word addr,.word val] with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) =
      pure (match r.emitEvent c "Mint" [.word addr,.word val] with
        | .ok updated => Result.normal updated | .error err => Result.reverted r err)
  cases r.emitEvent c "Mint" [.word addr,.word val] <;> rfl
theorem burnEmission (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (addr val : Nat)
    (A : r.lookupLocal? "account"=some (.word addr)) (V : r.lookupLocal? "valueAttoRep"=some (.word val))
    (storage : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Stmt.eval (n+1) t c r (.emitEvent "Burn" (args .burn)) =
      pure (match r.emitEvent c "Burn" (values .burn r.state addr val) with
        | .ok updated => Result.normal updated | .error err => Result.reverted r err) := by
  obtain ⟨topic,declEq⟩ := layout .burn
  have found : c.eventDecl? "Burn" = some (decl .burn topic) := by
    change c.eventDecls.find? _ = _
    rw [events]; exact declEq
  rw [Stmt.eval]
  dsimp only
  rw [found]
  change (do
    match ← (Expr.evalList c r (args .burn)).caught with
    | .ok (vs,next) =>
      match next.materializeForValueUseList c ((List.range 3).filterMap fun i =>
        (([0,1,2].zip vs).find? (fun p => p.1 == i)).map Prod.snd) with
      | .ok vals =>
        match next.emitEvent c "Burn" vals with
        | .ok updated => pure (Result.normal updated)
        | .error err => pure (Result.reverted r err)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err) : SolI Result) = _
  rw [logArgs _ _ _ _ _ storage A V]
  have mat : r.materializeForValueUseList c [.word addr,.word val,.word (WordField.stored r.state theoretical)] = .ok [.word addr,.word val,.word (WordField.stored r.state theoretical)] := by
    simp [Runtime.materializeForValueUseList,Runtime.materializeForValueUse,Runtime.materializeForValueUseFuel,Bind.bind,Except.bind]
  change (match r.materializeForValueUseList c [.word addr,.word val,.word (WordField.stored r.state theoretical)] with
    | .ok vals =>
      match r.emitEvent c "Burn" vals with
      | .ok updated => (pure (Result.normal updated) : SolI Result)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [mat]
  dsimp only
  change (match r.emitEvent c "Burn" [.word addr,.word val,.word (WordField.stored r.state theoretical)] with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) =
      pure (match r.emitEvent c "Burn" [.word addr,.word val,.word (WordField.stored r.state theoretical)] with
        | .ok updated => Result.normal updated | .error err => Result.reverted r err)
  cases r.emitEvent c "Burn" [.word addr,.word val,.word (WordField.stored r.state theoretical)] <;> rfl
end Inv39.SupplyEvents
