import Inv39MotionArgs
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Motion
def fromAddress (k : Kind) (a : Nat) := if k = .mint then 0 else a
def toAddress (k : Kind) (a b : Nat) := match k with | .transfer => b | .mint => a | .burn => 0
def frame (k : Kind) (a b val : Nat) : Frame := match k with
  | .transfer => [("from",.word a),("to",.word b),("value",.word val)]
  | _ => [("account",.word a),("value",.word val)]
theorem guardRun (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name msg : String) (a : Nat)
    (look : r.lookupLocal? name=some (.word a)) (bound : a<R) (ne : a≠0) :
    Stmt.eval (n+2) t c r (forbid name msg).value = pure (.normal r) := by
  change Stmt.eval (n+2) t c r (.ifElse (zeroTest name) (.block [.revertError (some msg)]) .skip) = _
  have cond := zeroResult c r name a bound look
  simp only [ne,decide_false] at cond
  rw [Inv32Blocks.branch (n+1) t c r _ _ _ false cond]
  change Stmt.eval (n+1) t c r .skip = _
  rw [Stmt.eval]
theorem movement (n : Nat) (c : Context) (r : Runtime) (k : Kind) (a b val : Nat)
    (av : a<2^160) (bv : b<2^160) (valWord : val<R) (aNonzero : a ≠ 0) (bNonzero : k=.transfer → b ≠ 0)
    (debit : ERC20.fromBounds r.state (fromAddress k a) val)
    (credit : ERC20.toBounds (ERC20.afterFrom r.state (fromAddress k a) val) (toAddress k a b) val)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    let start := r.withFrame (frame k a b val)
    ∃ next, Stmt.eval (n+12) model.core.table c start (shape k).value = pure (.normal next) ∧
      next.locals=start.locals ∧ next.state.storage=(ERC20.afterTo (ERC20.afterFrom r.state (fromAddress k a) val) (toAddress k a b) val).storage := by
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
  have db : dst<2^160 := by dsimp only [dst]; cases k <;> simp_all [toAddress]
  obtain ⟨done,call,frameOk,storeOk⟩ := invokeUpdate n c inner k src dst val x y qty sb db valWord debit credit fields events
  have aw : a<R := lt_trans av (by decide)
  have bw : b<R := lt_trans bv (by decide)
  have doLast := (seqStep _ _ _ _ _ _ [] call).trans (show Stmt.evalList (n+10) t c done [] = pure (.normal done) by rw [Stmt.evalList])
  have innerBody : Stmt.eval (n+11) t c outer (.block (((checks k).map (·.value)) ++ [(argsBlock k).value])) = pure (.normal done.popScope) := by
    apply Inv32Hoist.block
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
  refine ⟨done.popScope.popScope,?_,?_,storeOk⟩
  · apply Inv32Hoist.block
    have tail := (seqStep _ _ _ _ _ _ _ param).trans ((seqStep _ _ _ _ _ _ [] innerBody).trans (show Stmt.evalList (n+11) t c done.popScope [] = _ by rw [Stmt.evalList]))
    cases k <;> first | exact (seqStep _ _ _ _ _ _ _ skip).trans tail
                       | exact (seqStep _ _ _ _ _ _ _ skip).trans ((seqStep _ _ _ _ _ _ _ skip).trans tail)
  · change (done.locals.drop 1).drop 1=start.locals
    rw [frameOk]; rfl
end Inv39.Motion
