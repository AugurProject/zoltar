import Inv32ProductCall
open SolidCore.Solidity.Source Inv32Division
namespace Inv32Temps
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem copy (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (dst src : String) (old v : Nat) (d : r.lookupLocal? dst = some (.word old))
    (s : r.lookupLocal? src = some (.word v)) (u : r.assignLocal? dst (.word v) = some next) :
    Stmt.eval (n+1) t c r (.assign (.var dst) (.var src)) = pure (.normal next) := by
  have ds : r.lookupMemoryRef? dst = none := by simp [Runtime.lookupMemoryRef?,d]
  have ss : r.lookupStorageBase? src = none := by simp [Runtime.lookupStorageBase?,s]
  have read : Expr.eval c r (.var src) = pure (.word v,r) := Inv32Guards.readWord _ _ _ _ _ s
  have resolved := Inv32Writes.resolve c r dst old d
  have written : (ResolvedLValue.local dst).write c r (.word v) = .ok next := by simp [ResolvedLValue.write,u]
  rw [Stmt.eval]; dsimp only
  simp only [ds,LValue.wantsMemoryRefRhs,Option.isSome_none,if_false,Bool.false_eq_true,read,ss]
  change (do match ← ((LValue.var dst).resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.word v) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [resolved]
  change (match (ResolvedLValue.local dst).write c r (.word v) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) = _
  rw [written]

theorem temp (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name arg : String)
    (v : Nat) (bound : v < R) (look : r.lookupLocal? arg = some (.word v)) :
    Stmt.eval (n+1) t c r (.varDecl .uint256 name (some (.castOp .uintCleanup 256 (.var arg)))) =
      pure (.normal (r.declareLocal name (.word v))) := by
  have h : Expr.eval c r (.castOp .uintCleanup 256 (.var arg)) = pure (.word v,r) :=
    Inv32Guards.clean _ _ _ _ _ bound (Inv32Guards.readWord _ _ _ _ _ look)
  rw [Stmt.eval]; dsimp only; rw [h]; rfl

theorem captured (n : Nat) (c : Context) (r next : Runtime) (x y hi lo : String)
    (a b : Nat) (ha : a < R) (hb : b < R) (ax : r.lookupLocal? x = some (.word a))
    (by' : r.lookupLocal? y = some (.word b))
    (store : r.assignNamedValuesRef? [hi,lo] [.word (a*b/R),.word (a*b%R)] = some next)
    (enough : 6 ≤ n) :
    Stmt.eval (n+2) Inv32Dispatch.model.core.table c r
      (.captureReturn [hi,lo] (.internalCall [hi,lo] Inv32Bodies.Mul512.key [.var x,.var y])) =
      pure (.normal next) := by
  apply Inv32Internal.capture
  rw [Inv32ProductCall.evaluates _ _ _ _ _ _ _ _ ha hb ax by' enough]
  simp [internalCallAssign,store]
end Inv32Temps
