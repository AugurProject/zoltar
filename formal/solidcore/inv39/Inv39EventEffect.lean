import Inv39UpdateStores
open SolidCore.Solidity.Source
namespace Inv39
theorem logPreservesStorage (c : Context) (r after : Runtime) (name : String) (vs : List Value)
    (ok : r.emitEvent c name vs = .ok after) : after.state.storage = r.state.storage ∧ after.locals = r.locals := by
  unfold Runtime.emitEvent at ok
  dsimp only at ok
  split at ok
  · injection ok with h; subst after; exact ⟨rfl,rfl⟩
  · contradiction
private theorem okBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem args3 (c : Context) (r : Runtime) (a b d : String) (x y z : Nat)
    (A : r.lookupLocal? a=some (.word x)) (B : r.lookupLocal? b=some (.word y)) (D : r.lookupLocal? d=some (.word z)) :
    Expr.evalList c r [.var a,.var b,.var d] = pure ([.word x,.word y,.word z],r) := by
  change Expr.evalListFuel 7 c r [.var a,.var b,.var d] = _
  simp only [Expr.evalListFuel, Inv32Guards.readWord _ _ _ _ _ A,Inv32Guards.readWord _ _ _ _ _ B,
    Inv32Guards.readWord _ _ _ _ _ D,okBind]
end Inv39
