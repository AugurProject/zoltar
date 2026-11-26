import Inv08CheckpointShape
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Checkpoint
def deferredField (eth : Bool) : Field := if eth then .ethDeferred else .repDeferred
def staleAmount (eth : Bool) := if eth then "staleEth" else "staleRep"
def deferStmt (eth : Bool) := ReleaseWrites.update Inv32Shapes.BinaryOp_add (deferredField eth).name (Inv03.Bodies.varP (staleAmount eth))
def deferAsset (s : State) (eth : Bool) (a : Nat) :=
  let k := deferredField eth
  s.storeFieldWord k.field (stored s k+a)
theorem deferRuns (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (eth : Bool) (a : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (look : r.lookupLocal? (staleAmount eth)=some (.word a))
    (fit : stored r.state (deferredField eth)+a<R) :
    (deferStmt eth).value.eval (n+1) t c r=pure (.normal {r with state:=deferAsset r.state eth a}) := by
  let k := deferredField eth
  let v := stored r.state k+a
  have E := compound c r k 3 a v (.var (staleAmount eth)) .add fields fit (Inv32Guards.readWord _ _ _ _ _ look) (Inv40.addWords _ _ _ fit)
  have expr (expr : Expr) (next : Runtime) (value : Nat) (read : expr.eval c r=pure (.word value,next)) :
      Stmt.eval (n+1) t c r (.exprStmt expr)=pure (.normal next) := by
    rw [Stmt.eval]; dsimp only; rw [read]; rfl
  exact expr _ _ _ E
def deferred (s : State) (e p : Nat) := deferAsset (deferAsset s true e) false p
theorem secondUnaffected (s : State) (e : Nat) : stored (deferAsset s true e) .repDeferred=stored s .repDeferred := by
  change (s.storeSlot 3 _).loadSlot 4=_
  rw [slotAfter,if_neg (by decide)]
  rfl
theorem deferredStorage (s : State) (e p : Nat) (eth : Bool)
    (ef : stored s .ethDeferred+e<R) (pf : stored s .repDeferred+p<R) :
    stored (deferred s e p) (deferredField eth)=stored s (deferredField eth)+(if eth then e else p) := by
  cases eth
  · change (((s.storeSlot 3 _).storeSlot 4 _).loadSlot 4)=_
    rw [slotAfter,if_pos rfl]
    change SolidCore.Solidity.Shared.norm (stored (deferAsset s true e) .repDeferred+p)=_
    rw [secondUnaffected]
    exact Nat.mod_eq_of_lt pf
  · change (((s.storeSlot 3 _).storeSlot 4 _).loadSlot 3)=_
    rw [slotAfter,if_neg (by decide),slotAfter,if_pos rfl]
    change SolidCore.Solidity.Shared.norm (stored s .ethDeferred+e)=_
    exact Nat.mod_eq_of_lt ef
end Inv08.Checkpoint
