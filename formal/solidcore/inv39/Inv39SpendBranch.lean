import Inv39ApprovalHoist
import Inv39SpendMath
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Allowance
def afterSpend (s : State) (o sp old v : Nat) := if old<R-1 then s.storeSlot (slot o sp) (old-v) else s
theorem spendIf (n : Nat) (c : Context) (r : Runtime) (o sp old v : Nat) (O : r.lookupLocal? "owner"=some (.word o))
    (S : r.lookupLocal? "spender"=some (.word sp)) (B : r.lookupLocal? "currentAllowance"=some (.word old)) (V : r.lookupLocal? "value"=some (.word v))
    (ow : o<2^160) (sw : sp<2^160) (on : old<R-1 → o≠0) (sn : old<R-1 → sp≠0) (fit : old<R) (enough : old<R-1 → v≤old)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ q, Stmt.eval (n+12) model.core.table c r (.ifElse finite.value spendBranch.value .skip)=pure (.normal q) ∧
      q.locals=r.locals ∧ q.state.storage=(afterSpend r.state o sp old v).storage := by
  let t := model.core.table
  let cond := finiteCond c r old B fit
  by_cases bounded : old<R-1
  · have yes : finite.value.eval c r=pure (.word (boolWord true),r) := by simpa only [decide_eq_true bounded] using cond
    rw [Inv32Blocks.branch (n+11) t c r _ _ _ true yes]
    let body := r.pushScope
    have funded := enough bounded
    have test := lowCond c body old v B V fit (lt_of_le_of_lt funded fit)
    simp only [decide_eq_false (Nat.not_lt_of_ge funded)] at test
    let guard := Source.Stmt.ifElse low.value (.block [failLow.value]) .skip
    have checked : Stmt.eval (n+10) t c body guard=pure (.normal body) := by
      rw [show guard=Source.Stmt.ifElse low.value (.block [failLow.value]) .skip from rfl,Inv32Blocks.branch (n+9) t c body _ _ _ false test]
      change Stmt.eval (n+9) t c body .skip=_
      rw [Stmt.eval]
    let uc := {c with checked:=false}
    obtain ⟨q,exec,locals,store⟩ := hoistApprove n uc body.pushScope o sp (old-v) false reduced O S
      (reducedValue uc _ old v B V fit funded) ow sw (on bounded) (sn bounded) (lt_of_le_of_lt (Nat.sub_le _ _) fit) fields events
    have block := Inv32Blocks.one _ t uc body q _ exec
    have unchecked := ERC20.uncheckedStmt t c body q.popScope (n+9) _ block
    have grp := Inv32Hoist.block (n+10) t c r q.popScope _ ((seqStep _ _ _ _ _ _ _ checked).trans
      ((seqStep _ _ _ _ _ _ [] unchecked).trans (show Stmt.evalList (n+10) t c q.popScope []=pure (.normal q.popScope) by rw [Stmt.evalList])))
    refine ⟨q.popScope.popScope,grp,?_,by simpa only [afterSpend,if_pos bounded] using store⟩
    change (q.locals.drop 1).drop 1=_; rw [locals]; rfl
  · have no : finite.value.eval c r=pure (.word (boolWord false),r) := by simpa only [decide_eq_false bounded] using cond
    rw [Inv32Blocks.branch (n+11) t c r _ _ _ false no]
    refine ⟨r,?_,rfl,by simp [afterSpend,bounded]⟩
    change Stmt.eval (n+11) _ c r .skip=_
    rw [Stmt.eval]
end Inv39.Allowance
