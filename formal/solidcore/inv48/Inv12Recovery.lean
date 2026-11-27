import Inv12QuotaReadback
import Inv12Rounding
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv12

def neutralTarget : Pattern LValue :=
  ⟨.index (.var "fork") (.word 6), fun | .index (.var "fork") (.word 6) => true | _ => false,
    by intro v h; dsimp only at h; split at h <;> simp_all⟩
def neutralWrite := Stmt_assign neutralTarget
  (clean (clean (Expr_binary BinaryOp_sub (member "fork" 2) (member "fork" 5))))

theorem recoverBalance (n : Nat) (c : Context) (r : Runtime) (f : Ref)
    (fork : f.bound r "fork") (cash : f.hasField 2 2) (assignments : f.hasField 5 5) (neutral : f.hasField 6 6)
    (within : f.get r.state 5 ≤ f.get r.state 2) :
    Stmt.eval (n+1) model.core.table c r neutralWrite.value =
      pure (.normal {r with state:=putAmount r.state f.slot 6 (f.get r.state 2-f.get r.state 5)}) := by
  have fit := lt_of_le_of_lt (Nat.sub_le (f.get r.state 2) (f.get r.state 5)) (f.fits r.state 2)
  have diff := Inv08.ReleaseQuote.binary (f.cleanRead c r _ _ _ (by decide) fork cash)
    (f.cleanRead c r _ _ _ (by decide) fork assignments)
    .sub (by intro h; cases h) (by intro h; cases h) (Inv32QuoteExpr.subWord c.checked _ _ (f.fits _ _) (f.fits _ _) within)
  have rhs := Inv08.ReleaseQuote.readClean (Inv08.ReleaseQuote.readClean diff fit) fit
  exact assignField n _ c r _ _ 6 6 _ _ _ (by decide) fork neutral (rhs _ (Nat.le_succ _))

theorem recoveryBound (n : Nat) (c : Context) (r : Runtime) (f : Ref) (choices : List Nat)
    (fork : f.bound r "fork") (cash : f.hasField 2 2) (assignments : f.hasField 5 5) (neutral : f.hasField 6 6)
    (positive : 0<f.get r.state 1) (covered : choices.sum=f.get r.state 1)
    (recorded : f.get r.state 5=assigned (f.get r.state 2) (f.get r.state 1) choices) :
    ∃ next, Stmt.eval (n+1) model.core.table c r neutralWrite.value=pure (.normal next) ∧
      f.get next.state 6<choices.length := by
  obtain ⟨le,bound⟩ := roundedAllocation _ _ choices positive covered
  rw [← recorded] at le bound
  refine ⟨_,recoverBalance n c r f fork cash assignments neutral le,?_⟩
  change amountAt (putAmount r.state f.slot 6 (f.get r.state 2-f.get r.state 5)) f.slot 6<choices.length
  rw [amountAfter r.state f.slot 6 _ (lt_of_le_of_lt (Nat.sub_le _ _) (f.fits r.state 2))]
  exact bound
end Inv12
