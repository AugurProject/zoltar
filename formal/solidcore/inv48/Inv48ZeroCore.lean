import Inv48Model
import Inv32QuoteGuard
import Inv32Revert
open SolidCore.Solidity.Source Inv32Division Inv32FloorFastPath
namespace Inv48.Public
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

private theorem liftOk {α : Type} (a : α) : (liftM (Except.ok a : Except RevertData α) : SolI α) = pure a := rfl

def zeroFrame : Frame := [("proposedRepPerEthPrice", .word 0), ("_ret0", .word 0)]
def zeroStart (r : Runtime) := r.withFrame zeroFrame

def condition : Expr := .binary .ne (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice")) (.word 0)

theorem zeroCondition (c : Context) (r : Runtime) :
    Expr.eval c (zeroStart r).pushScope.pushScope condition =
      pure (.word 0, (zeroStart r).pushScope.pushScope) := by
  let src := (zeroStart r).pushScope.pushScope
  have look : src.lookupLocal? "proposedRepPerEthPrice" = some (.word 0) := rfl
  have read := Inv32Guards.clean 3 c src (.var "proposedRepPerEthPrice") 0 (by decide)
    (Inv32Guards.readWord 2 c src "proposedRepPerEthPrice" 0 look)
  change Expr.evalFuel 5 c src condition = _
  unfold condition
  rw [Expr.evalFuel] <;> try (intro bad; cases bad)
  change (do
    let (right, next) ← Expr.evalFuel 4 c src (.word 0)
    let (left, final) ← Expr.evalFuel 4 c next (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice"))
    let value ← liftM (BinaryOp.apply c.checked .ne left right)
    pure (value, final)) = _
  rw [show Expr.evalFuel 4 c src (.word 0) = pure (.word 0, src) from rfl]
  simp only [pb]
  rw [read]
  simp only [pb]
  have bin : BinaryOp.apply c.checked .ne (.word 0) (.word 0) = .ok (.word 0) := by
    cases c.checked <;> rfl
  rw [bin]
  rfl


def zeroCode (rest : List Stmt) : Stmt :=
  .block [cleanParam "proposedRepPerEthPrice", .skip,
    .block (.requireStmt condition (some "Initial oracle price zero") :: rest)]

theorem zeroExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (rest : List Stmt) :
    Stmt.eval (n+5) t c (zeroStart r) (zeroCode rest) =
      pure (.reverted (zeroStart r) (.error "Initial oracle price zero")) := by
  let src := zeroStart r
  let outer := src.pushScope
  let inner := outer.pushScope
  let err := RevertData.error "Initial oracle price zero"
  have guard := Inv32QuoteGuard.requireEval (n+2) t c inner condition false "Initial oracle price zero" (zeroCondition c r)
  have stop := Inv32Revert.stop (n+3) t c inner inner _ rest err guard
  have block := Inv32Revert.blockRevert (n+3) t c outer inner _ err stop
  have clean := cleanParamExec (n+3) t c outer "proposedRepPerEthPrice" 0 (by decide) rfl (by
    simp [outer,src,zeroStart,zeroFrame,Runtime.withFrame,Runtime.pushScope,
      Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have skip : Stmt.eval (n+4) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  unfold zeroCode
  apply Inv32Revert.blockRevert (n+4) t c src outer _ err
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ clean).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip).trans
      (Inv32Revert.stop _ _ _ _ _ _ [] _ block))

#print axioms zeroExecution

#print axioms zeroCondition
end Inv48.Public
