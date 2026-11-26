import Inv39ApprovalEvent
import Inv39AllowanceRead
import Inv39ZeroGuard
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
def args4 (o s v : Nat) (flag : Bool) : Source.Frame := [("owner",.word o),("spender",.word s),("value",.word v),("emitEvent",.word (boolWord flag))]
def notifyStmt := Source.Stmt.ifElse (.var "emitEvent") (.block [approvalLog.value]) .skip
theorem notification (n : Nat) (c : Context) (r : Runtime) (o s v : Nat) (flag : Bool) (O : r.lookupLocal? "owner"=some (.word o))
    (S : r.lookupLocal? "spender"=some (.word s)) (V : r.lookupLocal? "value"=some (.word v)) (F : r.lookupLocal? "emitEvent"=some (.word (boolWord flag)))
    (ofit : abiAddressFits o) (sfit : abiAddressFits s) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ q, Stmt.eval (n+3) model.core.table c r notifyStmt=pure (.normal q) ∧ q.locals=r.locals ∧ q.state.storage=r.state.storage := by
  have cond : (Source.Expr.var "emitEvent").eval c r=pure (.word (boolWord flag),r) := Inv32Guards.readWord _ _ _ _ _ F
  unfold notifyStmt
  rw [Inv32Blocks.branch _ _ _ _ _ _ _ flag cond]
  cases flag with
  | false =>
    refine ⟨r,?_,rfl,rfl⟩
    change Stmt.eval (n+2) _ c r .skip=_
    rw [Stmt.eval]
  | true =>
    obtain ⟨q,logged,storage,locals⟩ := emit c r.pushScope model.core.table n o s v O S V ofit sfit events
    refine ⟨q.popScope,Inv32Blocks.one _ _ _ _ _ _ logged,?_,storage⟩
    change q.locals.drop 1=r.locals
    rw [locals]; rfl
theorem approveBody (n : Nat) (c : Context) (r : Runtime) (o s v : Nat) (flag : Bool) (ow : o<2^160) (sw : s<2^160)
    (on : o≠0) (sn : s≠0) (fit : v<R) (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    let start := r.withFrame (args4 o s v flag)
    ∃ q, Stmt.eval (n+5) model.core.table c start approveShape.value=pure (.normal q) ∧ q.locals=start.locals ∧
      q.state.storage=(r.state.storeSlot (slot o s) v).storage := by
  let t := model.core.table
  let start := r.withFrame (args4 o s v flag)
  let outer := start.pushScope
  let inner := outer.pushScope
  let updated := {inner with state:=inner.state.storeSlot (slot o s) v}
  have oz := Motion.guardRun (n+1) t c inner "owner" "ERC20 approval owner must not be the zero address" o rfl (lt_trans ow (by decide)) on
  have sz := Motion.guardRun (n+1) t c inner "spender" "ERC20 approval spender must not be the zero address" s rfl (lt_trans sw (by decide)) sn
  have store := assign c inner t o s v (n+2) rfl rfl rfl fit fields
  have abi (x : Nat) (bound : x<2^160) : abiAddressFits x := by
    simpa [abiAddressFits,show Shared.norm x=x from Nat.mod_eq_of_lt (lt_trans bound (by decide))] using bound
  obtain ⟨q,em,locals,storage⟩ := notification n c updated o s v flag rfl rfl rfl rfl (abi o ow) (abi s sw) events
  have body := Inv32Hoist.block (n+3) t c outer q _ ((seqStep _ _ _ _ _ _ _ oz).trans ((seqStep _ _ _ _ _ _ _ sz).trans
    ((seqStep _ _ _ _ _ _ _ store).trans ((seqStep _ _ _ _ _ _ [] em).trans (show Stmt.evalList (n+3) t c q []=pure (.normal q) by rw [Stmt.evalList])))))
  have sk : Stmt.eval (n+4) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have param := cleanParamExec (n+3) t c outer "value" v fit rfl (by dsimp [outer,start,args4]; write_param)
  refine ⟨q.popScope.popScope,?_,?_,storage⟩
  · apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ param).trans
      ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ [] body).trans (show Stmt.evalList (n+4) t c q.popScope []=pure (.normal q.popScope) by rw [Stmt.evalList])))))
  · change (q.locals.drop 1).drop 1=start.locals
    rw [locals]; rfl
end Inv39.Allowance
