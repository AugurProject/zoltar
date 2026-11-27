import Inv39RepeatBinding
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
set_option maxHeartbeats 4000000
namespace Inv39.Init.Repeat
theorem markerRead (c : Context) (r : Runtime) (n : Nat)
    (fields : c.storageFields=model.core.context.storageFields) :
    Source.Expr.evalFuel (n+2) c r (.castOp .uintCleanup 256 (.storageRead .ref "repNumber" [])) =
      pure (.word (Shared.norm (r.state.loadSlot 7)),r) := by
  have found : c.storageField? "repNumber"=some (field .number) := by
    change c.storageFields.find? _ = _; rw [fields]; exact layout .number
  have load : r.loadStorageField c "repNumber" = .ok (.word (r.state.loadSlot 7)) := by
    unfold Runtime.loadStorageField; rw [found]; rfl
  have read : Source.Expr.evalFuel (n+1) c r (.storageRead .ref "repNumber" []) = pure (.word (r.state.loadSlot 7),r) := by
    rw [Source.Expr.evalFuel]
    change (do let v ← liftM (r.loadStorageField c "repNumber"); pure (v,r)) = _
    rw [load]; rfl
  rw [Source.Expr.evalFuel,read]
  change ((liftM (uintCleanup? c.checked 256 (.word (r.state.loadSlot 7))) : SolI Source.Value) >>= fun v=>pure (v,r)) = _
  have idempotent : Shared.norm (Shared.norm (r.state.loadSlot 7))=Shared.norm (r.state.loadSlot 7) := Nat.mod_mod _ _
  have fit : Shared.norm (r.state.loadSlot 7)<2^256 := Nat.mod_lt _ (by decide)
  norm_num at fit
  simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,Nat.not_le_of_gt fit,Nat.mod_eq_of_lt fit,idempotent,Bind.bind,Except.bind]
  rfl
theorem markerReject (n : Nat) (c : Context) (r : Runtime)
    (fields : c.storageFields=model.core.context.storageFields)
    (nonzero : Shared.norm (r.state.loadSlot 7)≠0) :
    Source.Stmt.eval (n+1) model.core.table c r markerGuard = pure (.reverted r (.error "Reputation token already initialized")) := by
  have fit : Shared.norm (r.state.loadSlot 7)<R := Nat.mod_lt _ (by decide)
  have applied := Inv32WideGuards.eqWord c.checked (Shared.norm (r.state.loadSlot 7)) 0 fit (by decide)
  simp only [if_neg nonzero] at applied
  have cond : markerExpr.eval c r=pure (.word (boolWord false),r) := by
    unfold markerExpr
    apply Inv32Eval.binary 5 c r .eq (by intro h; cases h) (by intro h; cases h) _ _ _ _ _ (markerRead c r 3 fields) _ applied
    rw [Source.Expr.evalFuel]; rfl
  exact Inv32QuoteGuard.requireEval _ _ _ _ _ false _ cond
end Inv39.Init.Repeat
