import Inv32ExactToUint
import Inv32Blocks
namespace Inv32BoolHelper
open SolidCore.Solidity.Source Inv32Scalar

def frame (b : Bool) (u : Nat) : Frame := [("b", .word (boolWord b)),("u",.word u)]
private def eqF := binary .eq (by intro h; cases h) (by intro h; cases h)
def condition := eqF (choice (eqF (choice (localWord "b") (literal 1) (literal 0)) (literal 0))
  (literal 1) (literal 0)) (literal 0)
def env (b : Bool) (name : String) : Option Nat := if name = "b" then some (boolWord b) else none
private theorem computed : ∀ b : Bool, condition.run false (env b) = some (boolWord b) := by native_decide

theorem execute (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (b : Bool) :
    Stmt.eval (n+6) t c (r.withFrame (frame b 0)) Inv32Bodies.ToUint.body =
      pure (.normal (r.withFrame (frame b (boolWord b)))) := by
  let src := r.withFrame (frame b 0)
  let dst := r.withFrame (frame b (boolWord b))
  let inside := src.pushScope.pushScope.pushScope
  let after := dst.pushScope.pushScope.pushScope
  let ctx := {c with checked := false}
  let one : Stmt := .assign (.var "u") (.word 1)
  let zero : Stmt := .assign (.var "u") (.word 0)
  let stmt : Stmt := .ifElse condition.core one zero
  have modeled : Models inside (env b) := by
    intro name v known
    unfold env at known
    split at known
    · rename_i eq
      subst name
      cases known
      rfl
    · contradiction
  have cond := condition.sound (condition.core.orderFuel+1) ctx inside (env b) _ (by decide) modeled (computed b)
  have body : Stmt.eval (n+2) t ctx inside stmt = pure (.normal after) := by
    rw [show stmt = .ifElse condition.core one zero by rfl, Inv32Blocks.branch _ _ _ _ _ _ _ b cond]
    cases b <;> apply Inv32Writes.constant _ _ _ _ _ _ 0 _ rfl <;>
      simp [inside, after, src, dst, Runtime.assignLocal?, Runtime.lookupLocal?, Runtime.pushScope, Runtime.withFrame, frame, LocalEnv.assign?, LocalEnv.lookup?, Frame.lookup?, Frame.assign?, Value.coerceLike?, boolWord, normWord] <;> decide
  have inner := Inv32Blocks.one _ t ctx src.pushScope.pushScope after stmt body
  have uncheckedBlock : Stmt.eval (n+4) t c src.pushScope.pushScope (.unchecked (.block [stmt])) =
      pure (.normal dst.pushScope.pushScope) := by rw [Stmt.eval]; exact inner
  have middle := Inv32Blocks.one _ t c src.pushScope dst.pushScope.pushScope _ uncheckedBlock
  exact Inv32Blocks.skips _ t c src dst.pushScope _ middle
end Inv32BoolHelper
