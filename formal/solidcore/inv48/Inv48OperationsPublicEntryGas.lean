import Inv48OperationsPublicEntryGasSource
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
open Inv48.EscrowPrefix Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl


theorem cleanupBound (checked : Bool) (bits : Nat) (v out : Value)
    (positive : 0 < bits) (width : bits ≤ 256)
    (h : uintCleanup? checked bits v = .ok out) :
    ∃ g, out = .word g ∧ g < 2^bits := by
  simp only [uintCleanup?] at h
  cases forced : v.forceAbiLazy with
  | error err => simp [forced,Bind.bind,Except.bind] at h
  | ok value =>
    simp only [forced,Bind.bind,Except.bind] at h
    simp only [show (0 < bits && bits <= 256) = true by simp [positive,width],ite_true] at h
    cases storage : value.asStorageWord? with
    | none => simp [storage] at h
    | some w =>
      simp only [storage] at h
      split at h
      · contradiction
      · simp only [uintCast?] at h
        cases forced2 : value.forceAbiLazy with
        | error err => simp [forced2,Bind.bind,Except.bind] at h
        | ok value2 =>
          simp only [forced2,Bind.bind,Except.bind] at h
          cases storage2 : value2.asStorageWord? with
          | none => simp [storage2,positive,width] at h
          | some w2 =>
            simp [storage2,positive,width] at h
            exact ⟨_,h.symm,Nat.mod_lt _ (by positivity)⟩

theorem gasReadFrozen (c : Context) (r : Runtime) :
    ∃ result : Except SolidityFailure Value, Expr.eval c r gasRead = Interaction.done (result.map fun v => (v,r)) ∧
      ∀ v, result = .ok v → ∃ g, v = .word g ∧ g < 2^32 := by
  obtain ⟨result,eq⟩ := Inv48.BatchReadFrame.frozen c r batchGas
    (.indexVar "batch" (.word 0))
  unfold gasRead Expr.eval
  rw [Expr.evalFuel]
  change ∃ result : Except SolidityFailure Value, (Expr.eval c r batchGas >>= _) = _ ∧ _
  rw [eq]
  cases result with
  | error err => exact ⟨.error err,rfl,by intro v h; cases h⟩
  | ok value =>
    cases clean : uintCleanup? c.checked 32 value with
    | error err => exact ⟨.error (.revert err),by
        change (pure (value,r) >>= _) = _
        rw [pb]
        dsimp only
        rw [clean]
        rfl,by intro v h; cases h⟩
    | ok value2 =>
      refine ⟨.ok value2,?_,?_⟩
      · change (pure (value,r) >>= _) = _
        rw [pb]
        dsimp only
        rw [clean]
        rfl
      · intro v h
        cases h
        exact cleanupBound c.checked 32 value value2 (by decide) (by decide) clean

/-- A successful actual batch-gas hoist derives both the scalar value and its
uint32 bound, together with the exact resulting runtime. -/
theorem gasHoistExecution (n : Nat) (c : Context) (r final : Runtime)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r gasHoist)
      trace (.ok (.normal final))) :
    ∃ g, g < 2^32 ∧ Expr.eval c r gasRead = pure (.word g,r) ∧
      final = r.declareLocal "_sol_hoist_1" (.word g) := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    obtain ⟨result,eq,bound⟩ := gasReadFrozen c r
    cases result with
    | error err =>
      change Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
        (.varDecl .uint256 "_sol_hoist_1" (some gasRead))) trace (.ok (.normal final)) at run
      rw [Stmt.eval] at run
      dsimp only at run
      rw [eq] at run
      cases err <;> cases run
    | ok v =>
      obtain ⟨g,rfl,hg⟩ := bound v rfl
      change Expr.eval c r gasRead = pure (.word g,r) at eq
      have decl := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r
        "_sol_hoist_1" .uint256 gasRead g eq rfl
      change Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
        (.varDecl .uint256 "_sol_hoist_1" (some gasRead))) trace (.ok (.normal final)) at run
      rw [decl] at run
      have done := pureResult _ _ _ run
      exact ⟨g,hg,eq,Result.normal.inj done.2⟩

def callbackStage (r : Runtime) (g : Nat) : Runtime :=
  (r.declareLocal "_sol_hoist_0" (.word 4000000)).declareLocal "callbackGas" (.word (4000000+g))

def callbackPrefix : List Stmt := [
  .varDecl .uint256 "_sol_hoist_0" none,
  Inv48.OperationsWrapperArgs.getterP.value,
  Inv48.OperationsWrapperArgs.callbackP.value]

/-- Executes the real getter, capture/pop/copy, and callback declaration.
The getter and batch-hoist lookup obligations of callbackDeclaration are
proved from the concrete runtime produced here. -/
theorem callbackPrefixExecution (n : Nat) (c : Context) (r : Runtime) (g : Nat)
    (checked : c.checked = true) (hg : g < 2^32)
    (batch : r.lookupLocal? "_sol_hoist_1" = some (.word g)) :
    Stmt.evalList (n+6) Inv48.Source.model.core.table c r callbackPrefix =
      pure (.normal (callbackStage r g)) := by
  have decl := Inv48.CloneGetters.decl_none (n+5) Inv48.Source.model.core.table c r
    .uint256 "_sol_hoist_0"
  simp only [Ty.defaultValue] at decl
  have getter : Stmt.eval (n+5+1) Inv48.Source.model.core.table c
      (r.declareLocal "_sol_hoist_0" (.word 0)) Inv48.OperationsWrapperArgs.getterP.value =
      pure (.normal (r.declareLocal "_sol_hoist_0" (.word 4000000))) := by
    simpa only [Inv48.SimpleWrapperArgs.hoist] using
      Inv48.OperationsWrapperArgs.callbackGetterExecution n c r
  have callback := Inv48.OperationsWrapperArgs.callbackDeclaration (n+5) c
    (r.declareLocal "_sol_hoist_0" (.word 4000000)) g checked hg (by simp)
    (by simpa using batch)
  unfold callbackPrefix
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ getter,
    Inv48.WholeQuote.singleList,callback]
  rfl

/-- Starting from the successful actual batch-gas hoist, derive its value and
execute the actual callback prefix without supplying either hoist lookup. -/
theorem hoistToCallback (n m : Nat) (c : Context) (r final : Runtime)
    (checked : c.checked = true) (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r gasHoist)
      trace (.ok (.normal final))) :
    ∃ g, g < 2^32 ∧ Expr.eval c r gasRead = pure (.word g,r) ∧
      final = r.declareLocal "_sol_hoist_1" (.word g) ∧
      Stmt.evalList (m+6) Inv48.Source.model.core.table c final callbackPrefix =
        pure (.normal (callbackStage final g)) := by
  obtain ⟨g,hg,read,shape⟩ := gasHoistExecution n c r final trace run
  refine ⟨g,hg,read,shape,callbackPrefixExecution m c final g checked hg ?_⟩
  simp [shape]

/-- A successful read-only require supplies an actual nonzero condition word
and preserves the exact runtime. Errors and the false branch are eliminated
by the successful transcript. -/
theorem guardObservation (n : Nat) (c : Context) (r final : Runtime)
    (e : Expr) (reason : Option String) (read : Inv48.BatchReadFrame.Read e)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r
      (.requireStmt e reason)) trace (.ok (.normal final))) :
    ∃ v w, Expr.eval c r e = pure (v,r) ∧ v.expectWord = .ok w ∧ w ≠ 0 ∧ final = r := by
  cases n with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    dsimp only at run
    obtain ⟨result,eq⟩ := Inv48.BatchReadFrame.frozen c r e read
    cases result with
    | error err => rw [eq] at run; cases err <;> cases run
    | ok v =>
      change Expr.eval c r e = pure (v,r) at eq
      have caught : (Expr.eval c r e).caught = pure (.ok (v,r)) := by rw [eq]; rfl
      rw [caught,pb] at run
      dsimp only at run
      cases value : v.expectWord with
      | error err => rw [value] at run; have h := pureResult _ _ _ run; cases h.2
      | ok w =>
        rw [value] at run
        dsimp only at run
        split at run
        next nonzero =>
          have h := pureResult _ _ _ run
          exact ⟨v,w,eq,value,(by intro zero; subst w; simp [wordTruthy,SolidCore.Solidity.Shared.norm] at nonzero),Result.normal.inj h.2⟩
        next zero => cases reason <;> (have h := pureResult _ _ _ run; cases h.2)

theorem budgetExecution (n : Nat) (c : Context) (r final : Runtime)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r budgetGuard)
      trace (.ok (.normal final))) :
    ∃ v w, Expr.eval c r budget = pure (v,r) ∧ v.expectWord = .ok w ∧ w ≠ 0 ∧ final = r := by
  exact guardObservation n c r final budget _
    (.binary .le (by intro h; cases h) (by intro h; cases h)
      (.cast _ _ (.var _)) (.cast _ _ (.indexVar "batch" (.word 0)))) trace run
end Inv48.OperationsPublicEntry
