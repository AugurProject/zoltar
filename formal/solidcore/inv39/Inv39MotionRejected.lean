import Inv39MotionExecution
import Inv39FailedMotionArgs
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Motion
theorem rejectedMovement (n : Nat) (c : Context) (r : Runtime) (k : Kind) (a b val : Nat)
    (av : a<2^160) (bv : b<2^160) (valWord : val<R) (aNonzero : a ≠ 0) (bNonzero : k=.transfer → b ≠ 0)
    (spends : k≠.mint) (low : r.state.loadSlot (balanceSlot a)<val)
    (fields : c.storageFields=model.core.context.storageFields) :
    ∃ next, Stmt.eval (n+12) model.core.table c (r.withFrame (frame k a b val)) (shape k).value = pure (.reverted next ERC20.lowFunds) := by
  let t := model.core.table
  let start := r.withFrame (frame k a b val)
  let outer := start.pushScope
  let inner := outer.pushScope
  let src := fromAddress k a
  let dst := toAddress k a b
  have x : (sender k).value.eval c inner.pushScope = pure (.word src,inner.pushScope) := by
    cases k with
    | mint => change Expr.evalFuel 2 c _ (.word 0)=_; rw [Expr.evalFuel]; rfl
    | burn => exact Inv32Guards.readWord _ _ _ _ _ rfl
    | transfer => exact Inv32Guards.readWord _ _ _ _ _ rfl
  have y : (receiver k).value.eval c (stageA inner src) = pure (.word dst,stageA inner src) := by
    cases k with
    | mint => exact Inv32Guards.readWord _ _ _ _ _ rfl
    | burn => change Expr.evalFuel 2 c _ (.word 0)=_; rw [Expr.evalFuel]; rfl
    | transfer => exact Inv32Guards.readWord _ _ _ _ _ rfl
  have qty : inner.lookupLocal? "value" = some (.word val) := by cases k <;> rfl
  have sb : src<2^160 := by dsimp [src,fromAddress]; cases k <;> simp_all
  have srcEq : src=a := by simp [src,fromAddress,spends]
  obtain ⟨done,call⟩ := invokeFailedUpdate n c inner k src dst val x y qty sb valWord (srcEq ▸ aNonzero)
    (show inner.state.loadSlot (balanceSlot src)<val by simpa only [srcEq] using low) fields
  have aw : a<R := lt_trans av (by decide)
  have bw : b<R := lt_trans bv (by decide)
  have doLast := Inv32Revert.stop _ t c inner done (argsBlock k).value [] ERC20.lowFunds call
  have innerBody : Stmt.eval (n+11) t c outer (.block (((checks k).map (·.value)) ++ [(argsBlock k).value])) = pure (.reverted done.popScope ERC20.lowFunds) := by
    apply Inv32Revert.blockRevert
    cases k with
    | mint => exact (seqStep _ _ _ _ _ _ _ (guardRun (n+8) t c inner "account" "ERC20 mint receiver must not be the zero address" a rfl aw aNonzero)).trans doLast
    | burn => exact (seqStep _ _ _ _ _ _ _ (guardRun (n+8) t c inner "account" "ERC20 burn account must not be the zero address" a rfl aw aNonzero)).trans doLast
    | transfer =>
      exact (seqStep _ _ _ _ _ _ _ (guardRun (n+8) t c inner "from" "ERC20 transfer sender must not be the zero address" a rfl aw aNonzero)).trans
        ((seqStep _ _ _ _ _ _ _ (guardRun (n+8) t c inner "to" "ERC20 transfer receiver must not be the zero address" b rfl bw (bNonzero rfl))).trans doLast)
  have skip : Stmt.eval (n+11) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have valRead : outer.lookupLocal? "value"=some (.word val) := qty
  have same : outer.assignLocal? "value" (.word val)=some outer := by cases k <;> dsimp [outer,start,frame] <;> write_param
  have param := cleanParamExec (n+10) t c outer _ _ valWord valRead same
  refine ⟨done.popScope.popScope,?_⟩
  apply Inv32Revert.blockRevert
  have tail := (seqStep _ _ _ _ _ _ _ param).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ innerBody)
  cases k <;> first | exact (seqStep _ _ _ _ _ _ _ skip).trans tail
                     | exact (seqStep _ _ _ _ _ _ _ skip).trans ((seqStep _ _ _ _ _ _ _ skip).trans tail)
end Inv39.Motion
