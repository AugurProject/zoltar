import Inv39DeniedHoist
import Inv39SpendMath
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Allowance
abbrev lowAllowance := RevertData.error "ERC20 transfer amount exceeds spender allowance"
inductive ChargeDenied (o sp old v : Nat) : RevertData → Prop where
  | short (low : old<v) : ChargeDenied o sp old v lowAllowance
  | zero (enough : v≤old) (bad : o=0 ∨ sp=0) : ChargeDenied o sp old v (zeroApproval o)
theorem spendIfDenied (n : Nat) (c : Context) (r : Runtime) (o sp old v : Nat) (O : r.lookupLocal? "owner"=some (.word o))
    (S : r.lookupLocal? "spender"=some (.word sp)) (B : r.lookupLocal? "currentAllowance"=some (.word old)) (V : r.lookupLocal? "value"=some (.word v))
    (ow : o<R) (bounded : old<R-1) (vf : v<R) (err : RevertData) (bad : ChargeDenied o sp old v err) :
    ∃ q, Stmt.eval (n+12) model.core.table c r (.ifElse finite.value spendBranch.value .skip)=pure (.reverted q err) := by
  let t := model.core.table
  let body := r.pushScope
  have fit : old<R := by omega
  have condition := finiteCond c r old B fit
  simp only [decide_eq_true bounded] at condition
  rw [Inv32Blocks.branch (n+11) t c r _ _ _ true condition]
  let guard := Source.Stmt.ifElse low.value (.block [failLow.value]) .skip
  let tail := Source.Stmt.unchecked (.block [(approvedCall reduced (Inv03.Bodies.num 0)).value])
  have test := lowCond c body old v B V fit vf
  cases bad with
  | short less =>
    simp only [decide_eq_true less] at test
    have leaf : Stmt.eval (n+8) t c body.pushScope failLow.value=pure (.reverted body.pushScope lowAllowance) := by
      change Stmt.eval (n+8) t c _ (.revertError (some _))=_; rw [Stmt.eval]
    have g : Stmt.eval (n+10) t c body guard=pure (.reverted body lowAllowance) := by
      rw [show guard=Source.Stmt.ifElse low.value (.block [failLow.value]) .skip from rfl,Inv32Blocks.branch (n+9) t c body _ _ _ true test]
      exact Inv32Revert.blockRevert _ t c body body.pushScope _ _ (Inv32Revert.stop _ _ _ _ _ _ [] _ leaf)
    exact ⟨r,Inv32Revert.blockRevert _ t c r body _ _ (Inv32Revert.stop _ _ _ _ _ _ [tail] _ g)⟩
  | zero enough invalid =>
    simp only [decide_eq_false (Nat.not_lt_of_ge enough)] at test
    have g : Stmt.eval (n+10) t c body guard=pure (.normal body) := by
      rw [show guard=Source.Stmt.ifElse low.value (.block [failLow.value]) .skip from rfl,Inv32Blocks.branch (n+9) t c body _ _ _ false test]
      change Stmt.eval (n+9) t c body .skip=_; rw [Stmt.eval]
    let uc := {c with checked:=false}
    obtain ⟨q,fail⟩ := deniedHoist n uc body.pushScope o sp (old-v) false reduced O S (reducedValue uc _ old v B V fit enough)
      ow invalid (lt_of_le_of_lt (Nat.sub_le _ _) fit)
    have group := Inv32Revert.blockRevert _ t uc body q _ _ (Inv32Revert.stop _ _ _ _ _ _ [] _ fail)
    have unchecked : Stmt.eval (n+10) t c body tail=pure (.reverted q.popScope (zeroApproval o)) := by
      change Stmt.eval (n+10) t c body (.unchecked _) = _; rw [Stmt.eval]; exact group
    exact ⟨q.popScope.popScope,Inv32Revert.blockRevert _ t c r q.popScope _ _ ((seqStep _ _ _ _ _ _ _ g).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ unchecked))⟩
end Inv39.Allowance
