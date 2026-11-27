import Inv32Scalar
import Inv32ExactRoundsUp
open SolidCore.Solidity.Source Inv32Scalar
namespace Inv32RoundingHelper
private def eqF := binary .eq (by intro h; cases h) (by intro h; cases h)
private def modF := binary .mod (by intro h; cases h) (by intro h; cases h)
def calculation : Formula :=
  eqF (cast .cleanup 8 (cast .cleanup 8
    (modF (cast .uint 8 (localWord "rounding")) (cast .uint 8 (literal 2)))))
    (cast .uint 8 (literal 1))

def env (i : Fin 4) (name : String) : Option Nat := if name = "rounding" then some i.val else none

private theorem operation : ∀ (b : Bool) (i : Fin 4),
    calculation.run b (env i) = some (i.val % 2) := by native_decide

theorem evalExpression (c : Context) (r : Runtime) (i : Fin 4)
    (localValue : r.lookupLocal? "rounding" = some (.word i.val)) :
    calculation.core.eval c r = pure (.word (i.val%2),r) := by
  apply calculation.sound _ _ _ (env i) _ (by decide) _ (operation _ _)
  intro name v h
  unfold env at h
  split at h <;> simp_all

private theorem bindOk {α β : Type} (v : α) (k : α → SolI β) : (pure v >>= k) = k v := rfl

theorem execute (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (i : Fin 4)
    (present : r.lookupLocal? "rounding" = some (.word i.val)) :
    Stmt.eval (fuel+3) t c r Inv32Bodies.RoundsUp.body = pure (.returned r [.word (i.val%2)]) := by
  let inner := r.pushScope.pushScope
  have computed := evalExpression c inner i present
  have singleton : Expr.evalReturnList c inner [calculation.core] = pure ([.word (i.val%2)],inner) := by
    change (do let (v,r') ← calculation.core.eval c inner; pure ([v],r')) = _
    rw [computed]; rfl
  have ret : Stmt.eval (fuel+1) t c inner (.returnValues [calculation.core]) =
      pure (.returned inner [.word (i.val%2)]) := by
    rw [Stmt.eval]; dsimp only; rw [singleton]; rfl
  have innerBlock : Stmt.eval (fuel+2) t c r.pushScope (.block [.returnValues [calculation.core]]) =
      pure (.returned r.pushScope [.word (i.val%2)]) := by
    rw [Stmt.eval]; dsimp only; rw [Stmt.evalList, ret]; rfl
  change Stmt.eval (fuel+3) t c r (.block [.skip,.skip,.block [.returnValues [calculation.core]]]) = _
  rw [Stmt.eval]; dsimp only
  have skip : Stmt.eval (fuel+2) t c r.pushScope .skip = pure (.normal r.pushScope) := by rw [Stmt.eval]
  simp only [Stmt.evalList, skip, bindOk, innerBlock]
  rfl
end Inv32RoundingHelper
