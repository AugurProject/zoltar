import Inv39MotionExecution
import Inv32Revert
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Motion
theorem zeroGuard (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name msg : String)
    (look : r.lookupLocal? name=some (.word 0)) :
    Stmt.eval (n+3) t c r (forbid name msg).value = pure (.reverted r (.error msg)) := by
  change Stmt.eval (n+3) t c r (.ifElse (zeroTest name) (.block [.revertError (some msg)]) .skip) = _
  have cond := zeroResult c r name 0 (by decide) look
  rw [Inv32Blocks.branch (n+2) t c r _ _ _ true cond]
  have leaf : Stmt.eval (n+1) t c r.pushScope (.revertError (some msg))=pure (.reverted r.pushScope (.error msg)) := by rw [Stmt.eval]
  exact Inv32Revert.blockRevert (n+1) t c r r.pushScope _ _ (Inv32Revert.stop _ _ _ _ _ _ [] _ leaf)
def invalidEndpoint (k : Kind) (a b : Nat) : Prop := a=0 ∨ (k=.transfer ∧ b=0)
def zeroError (k : Kind) (a : Nat) : RevertData := .error (match k with
  | .mint => "ERC20 mint receiver must not be the zero address"
  | .burn => "ERC20 burn account must not be the zero address"
  | .transfer => if a=0 then "ERC20 transfer sender must not be the zero address" else "ERC20 transfer receiver must not be the zero address")
theorem zeroMotion (n : Nat) (c : Context) (r : Runtime) (k : Kind) (a b val : Nat)
    (fit : val<R) (av : a<R) (invalid : invalidEndpoint k a b) :
    let start := r.withFrame (frame k a b val)
    Stmt.eval (n+12) model.core.table c start (shape k).value = pure (.reverted start (zeroError k a)) := by
  let t := model.core.table
  let start := r.withFrame (frame k a b val)
  let outer := start.pushScope
  let inner := outer.pushScope
  have g (name msg : String) (look : inner.lookupLocal? name=some (.word 0)) := zeroGuard (n+7) t c inner name msg look
  have seq : Stmt.evalList (n+10) t c inner (((checks k).map (·.value)) ++ [(argsBlock k).value])=pure (.reverted inner (zeroError k a)) := by
    cases k with
    | mint =>
      have az : a=0 := invalid.elim id (fun h => by cases h.1)
      exact Inv32Revert.stop _ _ _ _ _ _ _ _ (g _ _ (show inner.lookupLocal? "account"=some (.word 0) by rw [←az]; rfl))
    | burn =>
      have az : a=0 := invalid.elim id (fun h => by cases h.1)
      exact Inv32Revert.stop _ _ _ _ _ _ _ _ (g _ _ (show inner.lookupLocal? "account"=some (.word 0) by rw [←az]; rfl))
    | transfer =>
      by_cases az : a=0
      · simp only [zeroError,if_pos az]
        exact Inv32Revert.stop _ _ _ _ _ _ _ _ (g _ _ (show inner.lookupLocal? "from"=some (.word 0) by rw [←az]; rfl))
      · have bz : b=0 := invalid.elim (fun h => False.elim (az h)) And.right
        simp only [zeroError,if_neg az]
        exact (seqStep _ _ _ _ _ _ _ (guardRun (n+8) t c inner "from" _ a rfl av az)).trans
          (Inv32Revert.stop _ _ _ _ _ _ _ _ (g _ _ (show inner.lookupLocal? "to"=some (.word 0) by rw [←bz]; rfl)))
  have grp := Inv32Revert.blockRevert _ t c outer inner _ _ seq
  have skip : Stmt.eval (n+11) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have valRead : outer.lookupLocal? "value"=some (.word val) := by cases k <;> rfl
  have same : outer.assignLocal? "value" (.word val)=some outer := by cases k <;> dsimp [outer,start,frame] <;> write_param
  have param := cleanParamExec (n+10) t c outer _ _ fit valRead same
  apply Inv32Revert.blockRevert (next:=outer)
  have tail := (seqStep _ _ _ _ _ _ _ param).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ grp)
  cases k <;> first | exact (seqStep _ _ _ _ _ _ _ skip).trans tail
                     | exact (seqStep _ _ _ _ _ _ _ skip).trans ((seqStep _ _ _ _ _ _ _ skip).trans tail)
end Inv39.Motion
