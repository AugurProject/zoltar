import Inv48EscrowEntryCore
import Inv32WideGuards
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
private theorem caughtPure {α : Type} (x : α) : (pure x : SolI α).caught = pure (.ok x) := by
  unfold SolI.caught
  change Interaction.tryCatch (Interaction.map Except.ok (.done (.ok x)))
    (fun failure => match failure with
      | .revert e => pure (.error e)
      | .outOfFuel => throw SolidityFailure.outOfFuel) = _
  rw [Interaction.map,Interaction.bind,Interaction.pure,Interaction.tryCatch]
  rfl

private theorem pb {α β : Type} (x : α) (k : α → SolI β) : pure x >>= k = k x := rfl

def lookupCaller (r : Runtime) : Runtime :=
  ((r.pushScope.declareLocal "_sol_hoist_0" (.word 0)).pushScope).declareLocal
    "_ret_reputationToken_0" (.word 0)
def lookupAssigned (r response : Runtime) (rep : Nat) : Runtime :=
  {response with locals := [[("_ret_reputationToken_0",.word rep)],
    [("_sol_hoist_0",.word 0)]] ++ r.locals}
def lookupHoisted (r response : Runtime) (rep : Nat) : Runtime :=
  {response with locals := [[("_ret_reputationToken_0",.word rep)],
    [("_sol_hoist_0",.word rep)]] ++ r.locals}
def prepared (r response : Runtime) (rep : Nat) : Runtime :=
  {response with locals := [[("rep",.word rep),("_sol_hoist_0",.word rep)]] ++ r.locals}
def lookupBlock : List Stmt := [.varDecl .address "_ret_reputationToken_0" none,
  .captureReturn ["_ret_reputationToken_0"]
    (.internalCall ["_ret_reputationToken_0"] "__internal_reputationToken()#[]" []),
  .assign (.var "_sol_hoist_0") (.var "_ret_reputationToken_0")]
def preparation : List Stmt := [.requireStmt (.binary .eq .caller .self) (some "Only report creation"),
  .varDecl .address "_sol_hoist_0" none,.block lookupBlock,
  .varDecl .address "rep" (some (.var "_sol_hoist_0"))]

macro "prepare_locals" : tactic => `(tactic|
  simp [lookupCaller,lookupAssigned,lookupHoisted,prepared,Runtime.pushScope,
    Runtime.popScope,Runtime.declareLocal,Runtime.lookupLocal?,Runtime.assignLocal?,
    Runtime.assignLocalRaw?,Runtime.assignNamedValuesRef?,Runtime.assignNamedValues?,
    Runtime.assignLocalRefAware?,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,
    Frame.lookup?,Frame.assign?,Value.coerceLike?])

theorem selfGuard (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (self : c.sender = c.self) (bound : c.self < 2^256) :
    Stmt.eval (n+1) t c r (.requireStmt (.binary .eq .caller .self) (some "Only report creation")) = pure (.normal r) := by
  have ev : Expr.eval c r (.binary .eq .caller .self) = pure (.word 1,r) := by
    unfold Expr.eval
    simp only [Expr.orderFuel]
    apply Inv32Eval.binary _ _ _ _ (by intro h; cases h) (by intro h; cases h) _ _ (.word c.sender) (.word c.self)
    · rw [Expr.evalFuel]
    · rw [Expr.evalFuel]
    · simpa [self] using Inv32WideGuards.eqWord c.checked c.self c.self bound bound
  change Stmt.eval (n+1) t c r (.requireStmt _ (some "Only report creation")) = _
  rw [Stmt.eval]
  dsimp only
  rw [ev]
  rfl

theorem prepareExecution (n : Nat) (t : FunctionTable) (c : Context)
    (r response : Runtime) (rep : Nat) (f : InternalFunction)
    (trace : Interaction.Transcript)
    (self : c.sender = c.self) (bound : c.self < 2^256)
    (found : t.lookup? "__internal_reputationToken()#[]" = some f)
    (returns : f.returns = [⟨"_ret0",.address,false⟩])
    (lookup : LookupResponse n t c f (lookupCaller r) response rep trace) :
    ExecutesOK (Stmt.evalList (n+3) t c r.pushScope preparation) trace
      (.normal (prepared r response rep)) := by
  have call := lookupResponseCall n t c (lookupCaller r) response
    (lookupAssigned r response rep) f "__internal_reputationToken()#[]"
    "_ret_reputationToken_0" rep trace found lookup
    (by simp [returns,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,
      Bind.bind,Except.bind]) (by prepare_locals)
  have capture : ExecutesOK (Stmt.eval (n+2) t c (lookupCaller r)
      (.captureReturn ["_ret_reputationToken_0"]
        (.internalCall ["_ret_reputationToken_0"] "__internal_reputationToken()#[]" [])))
      trace (.normal (lookupAssigned r response rep)) := by
    rw [Stmt.eval]
    simpa only [List.append_nil] using Interaction.Executes.bind_ok (next := fun out => match out with
        | .returned rr vs => if vs.isEmpty || ["_ret_reputationToken_0"].isEmpty then pure (.normal rr) else
          match rr.assignNamedValues? ["_ret_reputationToken_0"] vs with
          | some updated => pure (.normal updated)
          | none => pure (.reverted rr .typeMismatch)
        | out => pure out) call
      (show ExecutesOK (pure (Result.normal (lookupAssigned r response rep))) []
        (.normal (lookupAssigned r response rep)) from .done _)
  have assign : Stmt.eval (n+2) t c (lookupAssigned r response rep)
      (.assign (.var "_sol_hoist_0") (.var "_ret_reputationToken_0")) =
      pure (.normal (lookupHoisted r response rep)) := by
    rw [Stmt.eval]
    dsimp only
    have rhs : Expr.eval c (lookupAssigned r response rep) (.var "_ret_reputationToken_0") =
        pure (.word rep,lookupAssigned r response rep) := by
      unfold Expr.eval
      exact Inv32Guards.readWord _ _ _ _ _ (by prepare_locals)
    have noMem : (LValue.var "_sol_hoist_0").wantsMemoryRefRhs (lookupAssigned r response rep) = false := by
      simp [LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,lookupAssigned,
        Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
    rw [noMem]
    simp only [Bool.false_eq_true,if_false,rhs]
    have noTarget : (lookupAssigned r response rep).lookupMemoryRef? "_sol_hoist_0" = none := by
      simp [Runtime.lookupMemoryRef?,lookupAssigned,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
    have noSource : (lookupAssigned r response rep).lookupMemoryRef? "_ret_reputationToken_0" = none := by
      simp [Runtime.lookupMemoryRef?,lookupAssigned,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
    have noStorage : (lookupAssigned r response rep).lookupStorageBase? "_ret_reputationToken_0" = none := by
      simp [Runtime.lookupStorageBase?,lookupAssigned,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
    rw [noTarget,noSource]
    simp only [caughtPure,pb]

    rw [Inv32Writes.resolve c (lookupAssigned r response rep) "_sol_hoist_0" 0 (by prepare_locals)]
    simp only [caughtPure,pb,noStorage,Option.isSome_none,Bool.false_eq_true,if_false]
    change (match (ResolvedLValue.local "_sol_hoist_0").write c (lookupAssigned r response rep) (.word rep) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted (lookupAssigned r response rep) err)) = _
    simp [ResolvedLValue.write]
    prepare_locals
  have decl : Stmt.eval (n+2) t c
      (r.pushScope.declareLocal "_sol_hoist_0" (.word 0)).pushScope
      (.varDecl .address "_ret_reputationToken_0" none) =
      pure (.normal (lookupCaller r)) := by rw [Stmt.eval]; simp only [Ty.defaultValue]; try rfl
  have inner : ExecutesOK (Stmt.evalList (n+2) t c
      (r.pushScope.declareLocal "_sol_hoist_0" (.word 0)).pushScope lookupBlock)
      trace (.normal (lookupHoisted r response rep)) := by
    unfold lookupBlock
    rw [Stmt.evalList,decl]
    simp only [pb]
    rw [Stmt.evalList]
    have tail : ExecutesOK (Stmt.evalList (n+2) t c (lookupAssigned r response rep)
        [.assign (.var "_sol_hoist_0") (.var "_ret_reputationToken_0")]) []
        (.normal (lookupHoisted r response rep)) := by
      rw [Stmt.evalList,assign]
      simp only [pb]
      rw [Stmt.evalList]
      exact .done _
    simpa only [List.append_nil] using Interaction.Executes.bind_ok (next := fun out => match out with
      | .normal rr => Stmt.evalList (n+2) t c rr [.assign (.var "_sol_hoist_0") (.var "_ret_reputationToken_0")]
      | out => pure out) capture tail
  have block : ExecutesOK (Stmt.eval (n+3) t c
      (r.pushScope.declareLocal "_sol_hoist_0" (.word 0)) (.block lookupBlock)) trace
      (.normal (lookupHoisted r response rep).popScope) := by
    rw [Stmt.eval]
    simpa only [List.append_nil] using Interaction.Executes.bind_ok (next := fun out => pure (out.mapRuntime Runtime.popScope)) inner
      (show ExecutesOK (pure (Result.normal (lookupHoisted r response rep).popScope)) []
        (.normal (lookupHoisted r response rep).popScope) from .done _)
  have guard := selfGuard (n+2) t c r.pushScope self bound
  have hoist : Stmt.eval (n+3) t c r.pushScope (.varDecl .address "_sol_hoist_0" none) =
      pure (.normal (r.pushScope.declareLocal "_sol_hoist_0" (.word 0))) := by rw [Stmt.eval]; simp only [Ty.defaultValue]; try rfl
  have repDecl : Stmt.eval (n+3) t c (lookupHoisted r response rep).popScope
      (.varDecl .address "rep" (some (.var "_sol_hoist_0"))) =
      pure (.normal (prepared r response rep)) := by
    have rhs : Expr.eval c (lookupHoisted r response rep).popScope (.var "_sol_hoist_0") =
        pure (.word rep,(lookupHoisted r response rep).popScope) := by
      unfold Expr.eval
      exact Inv32Guards.readWord _ _ _ _ _ (by prepare_locals)
    rw [Stmt.eval]
    dsimp only
    rw [rhs]
    simp only [caughtPure,pb,Ty.coerceValue?]
    all_goals
      congr 2
  change Stmt.eval (n+3) t c r.pushScope
    (.requireStmt (.binary .eq .caller .self) (some "Only report creation")) = _ at guard
  unfold preparation
  rw [Stmt.evalList,guard]
  simp only [pb]
  rw [Stmt.evalList,hoist]
  simp only [pb]
  rw [Stmt.evalList]
  have tail : ExecutesOK (Stmt.evalList (n+3) t c (lookupHoisted r response rep).popScope
      [.varDecl .address "rep" (some (.var "_sol_hoist_0"))]) []
      (.normal (prepared r response rep)) := by
    rw [Stmt.evalList,repDecl]
    simp only [pb]
    rw [Stmt.evalList]
    exact .done _
  simpa only [List.append_nil] using Interaction.Executes.bind_ok (next := fun out => match out with
    | .normal rr => Stmt.evalList (n+3) t c rr [.varDecl .address "rep" (some (.var "_sol_hoist_0"))]
    | out => pure out) block tail

#print axioms selfGuard
#print axioms prepareExecution
end Inv48.EscrowEntry
