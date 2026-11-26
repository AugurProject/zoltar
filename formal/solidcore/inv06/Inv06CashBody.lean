import Inv06Partial
import Inv05MintRun
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath Inv32QuoteExpr Inv32Actions Inv03
namespace Inv06.Cash
def payment (cash units rem b : Nat) := if b=0 then 0 else if b=units then cash else rawValue b (cash*10^9-rem) units
theorem paymentBound (cash units rem b : Nat) (balance : b≤units) : payment cash units rem b ≤ cash := by
  unfold payment
  split
  · omega
  · split
    · rfl
    · exact withinCash _ _ _ _ balance
theorem run (f : Nat) (c : Context) (r : Runtime) (cash units rem b : Nat)
    (cap : cash<2^128) (book : units<2^128) (balance : b≤units) (le : rem≤cash*10^9) :
    let src := r.withFrame (frame cash units rem b)
    Stmt.eval (f+32) Inv03.model.core.table c src Shapes.cashShape.value =
      pure (.returned src [.word (payment cash units rem b)]) := by
  let t := Inv03.model.core.table
  let src := r.withFrame (frame cash units rem b)
  let outer := src.pushScope
  let inner := outer.pushScope
  let v := payment cash units rem b
  let first := Inv05.zeroCheck "burned" (.word 0)
  let cond := Inv32Product.eqF (w "burned") (w "units")
  let last := Stmt.ifElse cond.core (.returnValues [(w "cash").core]) Shapes.partialBody.value
  have hu : units<R := lt_trans book (by decide)
  have hc : cash<R := lt_trans cap (by decide)
  have hb := lt_of_le_of_lt balance hu
  have hr := lt_of_le_of_lt le (lt_trans (Nat.mul_lt_mul_of_pos_right cap (by decide : 0<10^9)) (by decide : 2^128*10^9<R))
  have steps : Stmt.evalList (f+30) t c inner [first,last] = pure (.returned inner [.word v]) := by
    by_cases z : b=0
    · have read := Inv32WideGuards.zeroValue c.checked (locals inner) "burned" b hb (by rfl)
      rw [if_pos z] at read
      have choose := Inv32Blocks.branch (f+29) t c inner _ (.returnValues [.word 0]) .skip true
        (evalFormula _ c inner 1 (by decide) read)
      have ret := Inv32CompareValues.retOne (f+28) t c inner (.word 0) 0 rfl
      rw [show v=0 from if_pos z]
      exact stop _ _ _ _ _ _ _ _ (choose.trans ret)
    · have skip := Inv05.skipZero (f+28) t c inner "burned" b hb (Nat.pos_of_ne_zero z) rfl (.word 0)
      refine (seqStep _ _ _ _ _ _ _ skip).trans (stop _ _ _ _ _ _ [] _ ?_)
      have B := Inv32ProductValues.cleanup (Inv32Scalar.localWord "burned") c.checked (locals inner) _ hb (by rfl)
      have U := Inv32ProductValues.cleanup (Inv32Scalar.localWord "units") c.checked (locals inner) _ hu (by rfl)
      have test : cond.run c.checked (locals inner)=some (boolWord (decide (b=units))) := by
        simp [cond,Inv32Product.eqF,Inv32Scalar.binary,w,B,U,Inv32WideGuards.eqWord _ _ _ hb hu,Inv32Scalar.projectWord,boolWord]
      dsimp only [last]
      rw [Inv32Blocks.branch (f+29) t c inner _ _ _ _ (evalFormula cond c inner _ (by decide) test)]
      by_cases full : b=units
      · have up : 0<units := by omega
        simp only [full,decide_true,if_true]
        rw [show v=cash by simp [v,payment,z,full, Nat.ne_of_gt up]]
        exact Inv32CompareValues.retOne _ _ _ _ _ _ (Inv32Guards.clean _ _ _ _ _ hc (Inv32Guards.readWord _ _ _ _ _ rfl))
      · simp only [full,decide_false,Bool.false_eq_true,if_false]
        rw [show v=rawValue b (cash*10^9-rem) units by simp [v,payment,z,full]]
        exact partialRun (f+1) c r cash units rem b cap book (by omega) balance le
  have mid := blockReturned (f+30) t c outer inner _ _ steps
  have A := cleanParamExec (f+30) t c outer "cash" cash hc rfl (by dsimp [outer,src,frame]; write_param)
  have B := cleanParamExec (f+30) t c outer "units" units hu rfl (by dsimp [outer,src,frame]; write_param)
  have C := cleanParamExec (f+30) t c outer "remainder" rem hr rfl (by dsimp [outer,src,frame]; write_param)
  have D := cleanParamExec (f+30) t c outer "burned" b hb rfl (by dsimp [outer,src,frame]; write_param)
  have S : Stmt.eval (f+31) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  exact blockReturned _ t c src outer _ _ ((seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans
    ((seqStep _ _ _ _ _ _ _ C).trans ((seqStep _ _ _ _ _ _ _ D).trans
      ((seqStep _ _ _ _ _ _ _ S).trans (stop _ _ _ _ _ _ [] _ mid))))))
end Inv06.Cash
