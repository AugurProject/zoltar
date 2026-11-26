import Inv06Shapes
import Inv05MintTail
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath Inv32Actions Inv32Scalar Inv32QuoteExpr
namespace Inv06.Net
def frame (cash rem : Nat) : Frame := [("cash",.word cash),("remainder",.word rem),("_ret0",.word 0)]
theorem run (f : Nat) (c : Context) (r : Runtime) (cash rem : Nat) (cap : cash<2^128) (le : rem≤cash*10^9) :
    let src := r.withFrame (frame cash rem)
    Stmt.eval (f+4) Inv03.model.core.table c src Shapes.netShape.value =
      pure (.returned src [.word (cash*10^9-rem)]) := by
  let t := Inv03.model.core.table
  let src := r.withFrame (frame cash rem)
  let outer := src.pushScope
  let work := outer.pushScope
  have hc : cash<R := lt_trans cap (by decide)
  have fit : cash*10^9<R := lt_trans (Nat.mul_lt_mul_of_pos_right cap (by decide : 0<10^9)) (by decide)
  have hr := lt_of_le_of_lt le fit
  let lit := Inv32NewtonBody.twice (literal (2^128))
  let limit := choice (literal 1) lit lit
  have cashRead := Inv32ProductValues.cleanup (localWord "cash") c.checked (locals work) _ hc (show locals work "cash"=some cash from rfl)
  have test := comparison c.checked (locals work) (w "cash") limit cash (2^128) hc (by decide) cashRead
    (show limit.run c.checked (locals work)=some (2^128) from Inv32ProductValues.cleanup _ _ _ _ (by decide) (Inv32ProductValues.cleanup _ _ _ _ (by decide) rfl))
  rw [show decide (cash<2^128)=true from decide_eq_true cap] at test
  have g := Inv05.guardResult (f+1) t c work Shapes.capTest.value "Settlement cash too large" true
    (evalFormula (Inv32Product.ltF (w "cash") limit) c work _ (by decide) test)
  have product := Inv03.Expressions.scaleValue (w "cash") c.checked (locals work) cash hc fit cashRead
  have sub := subValue c.checked (locals work) (Inv03.Expressions.product "cash") (w "remainder") (cash*10^9) rem
    fit hr le product (Inv32ProductValues.cleanup _ _ _ _ hr rfl)
  have ret := Inv32CompareValues.retOne (f+1) t c work Shapes.value.value (cash*10^9-rem)
    (evalFormula (nonnegativeSub (Inv03.Expressions.product "cash") (w "remainder")) c work _ (by decide) sub)
  have body := blockReturned (f+2) t c outer work _ _ ((seqStep _ _ _ _ _ _ _ g).trans (stop _ _ _ _ _ _ [] _ ret))
  have A := cleanParamExec (f+2) t c outer "cash" cash hc rfl (by dsimp [outer,src,frame]; write_param)
  have B := cleanParamExec (f+2) t c outer "remainder" rem hr rfl (by dsimp [outer,src,frame]; write_param)
  have sk : Stmt.eval (f+3) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  exact blockReturned _ t c src outer _ _ ((seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ body))))
end Inv06.Net
