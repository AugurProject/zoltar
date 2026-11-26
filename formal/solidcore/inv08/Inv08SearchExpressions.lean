import Inv08SearchBody
import Inv08Storage
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Expiry
private theorem bindOk {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl
def EndTable (c : Context) (state : State) (endAt : Nat → Nat) (last : Nat) :=
  ∀ (r : Runtime) (id : Nat), r.state=state → id≤last →
    r.loadStorageBasePath c (.field "expiries") [.word id,.word 0] = .ok (.word (endAt id))
theorem readEnd (c : Context) (r : Runtime) (name : String) (id endTime : Nat)
    (localId : r.lookupLocal? name=some (.word id))
    (storage : r.loadStorageBasePath c (.field "expiries") [.word id,.word 0] = .ok (.word endTime)) :
    Inv40.Reads c r (endField name).value endTime := by
  intro fuel enough
  have minFuel : 3 ≤ fuel := le_trans (by decide : 3 ≤ (Expr.index (.storageRead .element "expiries" [.var "id"]) (.word 0)).orderFuel) enough
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le minFuel
  rw [Nat.add_comm]
  have idRead := Inv32Guards.readWord n c r name id localId
  have element : Expr.resolveLValueFuel (n+2) c r (.storageIndex "expiries" (.var name)) =
      pure (.storageIndex "expiries" (.word id),r) := by
    simp only [Expr.resolveLValueFuel,idRead,bindOk]
  change Expr.evalFuel (n+3) c r (.index (.storageIndex "expiries" (.var name)) (.word 0)) = _
  rw [Expr.evalFuel]
  simp only [Expr.hasStorageRoot,if_true,element,bindOk,ResolvedLValue.asStoragePath?, Expr.evalFuel]
  change (do let v ← liftM (r.loadStorageBasePath c (.field "expiries") [.word id,.word 0]); pure (v,r)) = _
  rw [storage]; rfl
  all_goals simp [Expr.storageIndex]

theorem cleanValue (checked : Bool) (v : Nat) (fit : v<2^48) :
    uintCleanup? checked 48 (.word v) = .ok (.word v) := by
  have hw : v<R := lt_trans fit (by decide)
  norm_num at fit
  simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,show SolidCore.Solidity.Shared.norm v=v from Nat.mod_eq_of_lt hw,
    Nat.not_le_of_gt fit,Nat.mod_eq_of_lt fit,Bind.bind,Except.bind]
theorem cleaned {c : Context} {r : Runtime} {e : Expr} {a : Nat} (read : Inv40.Reads c r e a) (fit : a<2^48) :
    Inv40.Reads c r (.castOp .uintCleanup 48 e) a := by
  intro fuel enough
  change e.orderFuel+1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n =>
    rw [Expr.evalFuel,read _ (by omega)]
    simp only [bindOk,cleanValue _ _ fit]
    rfl
theorem local48 (c : Context) (r : Runtime) (name : String) (v : Nat) (fit : v<2^48)
    (look : r.lookupLocal? name=some (.word v)) : Inv40.Reads c r (w48 name).value v := by
  apply cleaned _ fit
  intro fuel enough
  cases fuel with
  | zero => change 1≤0 at enough; omega
  | succ n => exact Inv32Guards.readWord _ _ _ _ _ look

theorem ltEval (c : Context) (r : Runtime) (lo hi : Nat) (lf : lo<2^48) (hf : hi<2^48)
    (L : r.lookupLocal? "low"=some (.word lo)) (H : r.lookupLocal? "high"=some (.word hi)) :
    guard.value.eval c r = pure (.word (if lo<hi then 1 else 0),r) :=
  ReleaseQuote.binary (local48 _ _ _ _ lf L) (local48 _ _ _ _ hf H) .lt (by intro h; cases h) (by intro h; cases h)
    (Inv32QuoteExpr.lt _ _ _ (lt_trans lf (by decide)) (lt_trans hf (by decide))) _ (Nat.le_succ _)

theorem leEval (c : Context) (r : Runtime) (left right : String) (a b : Nat) (af : a<2^48) (bf : b<2^48)
    (L : r.lookupLocal? left=some (.word a)) (H : r.lookupLocal? right=some (.word b)) :
    (Expr.binary .le (w48 left).value (w48 right).value).eval c r = pure (.word (boolWord (decide (a≤b))),r) := by
  have op : BinaryOp.apply c.checked .le (.word a) (.word b) = .ok (.word (if a≤b then 1 else 0)) :=
    Inv32WideGuards.leWord _ _ (lt_trans af (by decide)) (lt_trans bf (by decide))
  simpa [boolWord] using ReleaseQuote.binary (local48 _ _ _ _ af L) (local48 _ _ _ _ bf H) .le
    (by intro h; cases h) (by intro h; cases h) op _ (Nat.le_succ _)
end Inv08.Expiry
