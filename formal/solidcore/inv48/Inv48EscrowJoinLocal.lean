import Inv48EscrowJoinCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def Frozen {α : Type} (r : Runtime) (tree : SolI (α × Runtime)) : Prop :=
  ∃ result : Except SolidityFailure α,
    tree = .done (result.map (fun value => (value,r)))

theorem varFrozen (c : Context) (r : Runtime) (name : String) :
    Frozen r (Expr.eval c r (.var name)) := by
  unfold Expr.eval
  rw [Expr.evalFuel]
  cases storage : r.lookupStorageBase? name with
  | some base =>
    simp only [storage]
    cases loaded : r.loadStorageBasePath c base [] with
    | ok value => exact ⟨.ok value,rfl⟩
    | error err => exact ⟨.error (.revert err),rfl⟩
  | none =>
    simp only [storage]
    cases binding : r.lookupLocal? name with
    | none => exact ⟨.error (.revert .typeMismatch),rfl⟩
    | some value =>
      simp only [binding]
      cases loaded : r.derefMemoryValue value with
      | ok value => exact ⟨.ok value,rfl⟩
      | error err => exact ⟨.error (.revert err),rfl⟩

theorem refVarFrozen (c : Context) (r : Runtime) (name : String) :
    Frozen r (Expr.evalRefArg c r (.var name)) := by
  simp only [Expr.evalRefArg]
  cases storage : r.lookupStorageBase? name with
  | some base => simp only [storage]; exact ⟨.ok base.toRefValue,rfl⟩
  | none =>
    simp only [storage]
    cases memory : r.lookupMemoryRef? name with
    | some id => simp only [memory]; exact ⟨.ok (.memoryRef id),rfl⟩
    | none => simpa only [memory] using varFrozen c r name

theorem refVarsFrozen (fuel : Nat) (c : Context) (r : Runtime) (names : List String) :
    Frozen r (Expr.evalRefArgListFuel fuel c r (names.map Expr.var)) := by
  induction fuel generalizing names with
  | zero => exact ⟨.error (.revert .typeMismatch),rfl⟩
  | succ fuel ih =>
    cases names with
    | nil => exact ⟨.ok [],rfl⟩
    | cons name names =>
      rw [List.map_cons,Expr.evalRefArgListFuel]
      obtain ⟨first,hfirst⟩ := refVarFrozen c r name
      rw [hfirst]
      cases first with
      | error err => exact ⟨.error err,rfl⟩
      | ok value =>
        obtain ⟨rest,hrest⟩ := ih names
        change (Frozen r (Expr.evalRefArgListFuel fuel c r (names.map Expr.var) >>= _))
        rw [hrest]
        cases rest with
        | error err => exact ⟨.error err,rfl⟩
        | ok values => exact ⟨.ok (value::values),rfl⟩

theorem immutableFrozen (c : Context) (r : Runtime) (name : String) :
    Frozen r (Expr.eval c r (.immutable name)) := by
  unfold Expr.eval
  rw [Expr.evalFuel]
  cases loaded : r.loadImmutableField c name with
  | ok value => exact ⟨.ok value,rfl⟩
  | error err => exact ⟨.error (.revert err),rfl⟩

theorem cleanupVarFrozen (c : Context) (r : Runtime) (name : String) (bits : Nat) :
    Frozen r (Expr.eval c r (.castOp .uintCleanup bits (.var name))) := by
  unfold Expr.eval
  rw [Expr.evalFuel]
  change Frozen r (Expr.eval c r (.var name) >>= _)
  obtain ⟨first,hfirst⟩ := varFrozen c r name
  rw [hfirst]
  cases first with
  | error err => exact ⟨.error err,rfl⟩
  | ok value =>
    change Frozen r (do
      let casted ← uintCleanup? c.checked bits value
      pure (casted,r))
    cases cleaned : uintCleanup? c.checked bits value with
    | ok out => exact ⟨.ok out,rfl⟩
    | error err => exact ⟨.error (.revert err),rfl⟩

theorem declarationNormal (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (ty : Ty) (name : String) (expr : Expr)
    (frozen : Frozen r (Expr.eval c r expr)) (trace : Interaction.Transcript)
    (run : Inv48.EscrowPrefix.ExecutesOK
      (Stmt.eval (n+1) t c r (.varDecl ty name (some expr))) trace (.normal final)) :
    ∃ value, trace = [] ∧ final = r.declareLocal name value := by
  rw [Stmt.eval] at run
  obtain ⟨result,tree⟩ := frozen
  dsimp only at run
  rw [tree] at run
  cases result with
  | error err => cases err <;> cases run
  | ok value =>
    change Inv48.EscrowPrefix.ExecutesOK
      (match ty.coerceValue? value with
       | some coerced => (pure (Result.normal (r.declareLocal name coerced)) : SolI Result)
       | none => pure (Result.reverted r .typeMismatch)) trace (Result.normal final) at run
    split at run
    next coerced h =>
      have eq := Inv48.EscrowPrefix.pureResult _ _ _ run
      cases eq.2
      exact ⟨coerced,eq.1,rfl⟩
    next h => have eq := Inv48.EscrowPrefix.pureResult _ _ _ run; cases eq.2

/-- Full arbitrary internal body and replies; variable arguments can include
    reference values. Their synchronous evaluation cannot change the caller. -/
theorem capturedVarsNormal (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (key : String) (names : List String) (trace : Interaction.Transcript)
    (run : Inv48.EscrowPrefix.ExecutesOK
      (Stmt.eval (n+2) t c r (.captureReturn [] (.internalCall [] key (names.map Expr.var))))
      trace (.normal final)) : final.locals = r.locals := by
  obtain ⟨result,arguments⟩ := refVarsFrozen (Expr.listEvalFuel (names.map Expr.var)) c r names
  change Expr.evalRefArgList c r (names.map Expr.var) = _ at arguments
  cases result with
  | ok values =>
    exact Inv48.EscrowPrefix.capturedInternalNormal n t c r key _ values arguments trace final run
  | error err =>
    rw [Stmt.eval] at run
    dsimp only at run
    simp only [List.isEmpty_nil,Bool.or_true,if_true] at run
    rw [Stmt.eval] at run
    dsimp only at run
    rw [arguments] at run
    cases err <;> cases run

#print axioms refVarsFrozen
#print axioms immutableFrozen
#print axioms cleanupVarFrozen
#print axioms declarationNormal
#print axioms capturedVarsNormal
#print axioms varFrozen
#print axioms refVarFrozen
end Inv48.EscrowJoin
