import Inv48LiquidationGuardArguments
import Inv48LiquidationGuardReadOnly
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
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

def uncertaintyRead : Expr := .castOp .uintCleanup 256 (.immutable "targetPriceErrorForDispute")

/-- Success recovers the actual immutable load and cleanup, even for arbitrary
physical stored values. No deployment-shape premise is added. -/
theorem physicalRead (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+1) LiquidationLibrary.table c r
      (.varDecl .uint256 "_ic_arg_1" (some uncertaintyRead))) tr (.ok (.normal final))) :
    ∃ value u, r.loadImmutableField c "targetPriceErrorForDispute" = .ok value ∧
      uintCleanup? c.checked 256 value = .ok (.word u) ∧ u<R := by
  have frozen : Expr.eval c r uncertaintyRead =
      (do let v ← liftM (r.loadImmutableField c "targetPriceErrorForDispute")
          let w ← liftM (uintCleanup? c.checked 256 v)
          pure (w,r)) := by
    change Interaction.bind
      (Interaction.bind (liftM (r.loadImmutableField c "targetPriceErrorForDispute") : SolI Value)
        (fun v => pure (v,r))) _ = _
    rw [Interaction.bind_assoc]
    rfl
  rw [Stmt.eval] at run
  dsimp only at run
  cases loaded : r.loadImmutableField c "targetPriceErrorForDispute" with
  | error err =>
    have failed : Expr.eval c r uncertaintyRead = (throw (.revert err) : SolI (Value × Runtime)) := by
      rw [frozen,loaded]
      rfl
    rw [failed] at run
    cases run
  | ok value =>
    cases cleaned : uintCleanup? c.checked 256 value with
    | error err =>
      have failed : Expr.eval c r uncertaintyRead = (throw (.revert err) : SolI (Value × Runtime)) := by
        rw [frozen,loaded]
        change ((pure value : SolI Value) >>= _) = _
        rw [pb]
        rw [cleaned]
        rfl
      rw [failed] at run
      cases run
    | ok v =>
      obtain ⟨u,rfl,fit⟩ := cleanupBound c.checked 256 value v (by decide) (by decide) cleaned
      exact ⟨value,u,rfl,cleaned,fit⟩

theorem hoistRead (h : HoistPath n c r final tr) (p : Nat) (hp : p<R)
    (P : h.declared.pushScope.lookupLocal? "proposedRepPerEthPrice" = some (.word p)) :
    ∃ value u, h.declared.pushScope.loadImmutableField c "targetPriceErrorForDispute" = .ok value ∧
      uintCleanup? c.checked 256 value = .ok (.word u) ∧ u<R := by
  have price : Expr.eval c h.declared.pushScope (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice")) =
      pure (.word p,h.declared.pushScope) := Inv32Guards.clean _ _ _ _ _ hp (Inv32Guards.readWord _ _ _ _ _ P)
  have decl := Inv32Hoist.declEval n LiquidationLibrary.table c h.declared.pushScope "_ic_arg_0" .uint256 _ p price rfl
  have run := h.argsRun
  change Interaction.Executes (Stmt.evalList (n+1) _ c h.declared.pushScope [_ ,_,_]) _ _ at run
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl] at run
  rw [Stmt.evalList] at run
  obtain ⟨v,a,b,sp,first,last⟩ := bindSuccess _ _ _ _ run
  cases v <;> try cases last
  case normal mid =>
    exact physicalRead n c (h.declared.pushScope.declareLocal "_ic_arg_0" (.word p)) mid a first
#print axioms physicalRead
#print axioms hoistRead
end GuardRecovery
