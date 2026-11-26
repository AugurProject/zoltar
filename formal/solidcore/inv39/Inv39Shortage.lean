import Inv39UpdateExecution
import Inv39GuardNumbers
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.ERC20
abbrev lowFunds := RevertData.error "ERC20 transfer amount exceeds sender balance"
theorem lacking (c : Context) (r : Runtime) (bal val : Nat) (look : r.lookupLocal? "fromBalance"=some (.word bal))
    (qty : r.lookupLocal? "value"=some (.word val)) (low : bal<val) (fit : val<R) : shortage.eval c r=pure (.word 1,r) := by
  have old := lt_trans low fit
  have prim := Inv32ProductValues.ltWord bal val old fit
  rw [if_pos low] at prim
  exact Inv32Eval.binary _ c r .lt (by intro h; cases h) (by intro h; cases h) _ _ _ _ _
    (Child.readClean _ c r _ _ old look) (Child.readClean _ c r _ _ fit qty) prim
theorem insufficientFunds (t : FunctionTable) (c : Context) (r : Runtime) (n src v : Nat)
    (S : r.lookupLocal? "from"=some (.word src)) (Q : r.lookupLocal? "value"=some (.word v))
    (low : r.state.loadSlot (balanceSlot src)<v) (fit : v<R) (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (n+4) t c r debit.value=pure (.reverted r lowFunds) := by
  let b := r.state.loadSlot (balanceSlot src)
  let d := r.pushScope.declareLocal "fromBalance" (.word b)
  have rd : (Inv03.Bodies.clean (balanceAt "from")).value.eval c r.pushScope = pure (.word b,r.pushScope) :=
    Inv32Guards.clean 5 c r.pushScope _ b (lt_trans low fit) (readMapping _ _ _ _ 3 S fields)
  have decl := Inv32Hoist.declEval (n+2) t c r.pushScope "fromBalance" .uint256 _ b rd (by rfl)
  have rejectLeaf : Stmt.eval (n+1) t c d.pushScope reject.value=pure (.reverted d.pushScope lowFunds) := by
    change Stmt.eval (n+1) t c _ (.revertError (some _))=_; rw [Stmt.eval]
  have rejectBlock := Inv32Revert.blockRevert _ t c d _ _ _ (Inv32Revert.stop _ _ _ _ _ _ [] _ rejectLeaf)
  have cond : Stmt.eval (n+3) t c d (.ifElse shortage (.block [reject.value]) .skip)=pure (.reverted d lowFunds) := by
    rw [Inv32Blocks.branch (n+2) t c d _ _ _ true (lacking c d b v rfl Q low fit)]
    exact rejectBlock
  exact Inv32Revert.blockRevert _ t c r d _ _ ((seqStep _ _ _ _ _ _ _ decl).trans (Inv32Revert.stop _ _ _ _ _ _ _ _ cond))
theorem updateRejected (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (src dst val : Nat)
    (sFit : src<R) (nz : src≠0) (low : r.state.loadSlot (balanceSlot src)<val) (fit : val<R)
    (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (n+7) t c (entry r src dst val) body.value=pure (.reverted (entry r src dst val) lowFunds) := by
  let start := entry r src dst val
  let outer := start.pushScope
  let inner := outer.pushScope
  have cond := zeroResult c inner "from" src sFit (by rfl)
  simp only [nz,decide_false] at cond
  have fromFail : Stmt.eval (n+5) t c inner fromStep.value=pure (.reverted inner lowFunds) := by
    change Stmt.eval (n+5) t c _ (.ifElse (zeroTest "from") mint.value debit.value)=_
    rw [Inv32Blocks.branch (n+4) t c _ _ _ _ false cond]
    exact insufficientFunds t c inner n src val rfl rfl low fit fields
  have group := Inv32Revert.blockRevert (n+5) t c outer inner _ _ (Inv32Revert.stop _ _ _ _ _ _ [toStep.value,transferEvent.value] _ fromFail)
  have skip : Stmt.eval (n+6) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have param := cleanParamExec (n+5) t c outer "value" val fit rfl (by dsimp [outer,start,entry]; write_param)
  exact Inv32Revert.blockRevert (n+6) t c start outer _ _ ((seqStep _ _ _ _ _ _ _ skip).trans ((seqStep _ _ _ _ _ _ _ skip).trans
    ((seqStep _ _ _ _ _ _ _ param).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ group))))
end Inv39.ERC20
