import Inv32RatioTest
import Inv32Loop
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Scalar Inv32Product Inv32QuoteExpr Inv32RatioTest
namespace Inv32RatioStep
abbrev view := "#view3812"
def minusOne := nonnegativeSub (w "midpoint") (literal 1)
def lowSet := Stmt.assign (.var "low") (w "midpoint").core
def highSet := Stmt.assign (.var "high") minusOne.core
def update := Stmt.ifElse (.var view) lowSet highSet
def block' := Stmt.block [.varDecl .bool flag none,code,.varDecl .bool view (some (.var flag)),update]
def iteration := Stmt.block [.varDecl .uint256 "midpoint" (some Inv32Midpoint.expr.core),block']
def cond := smaller "low" "high"
def ss := match Inv32Bodies.Ratio.body with | .block [_,_,_,_,.block xs] => xs | _ => []
theorem loopLocation : ss[3]? = some (.whileLoop cond.core iteration) := by rfl
def withView (r : Runtime) (s p o l h m : Nat) (ok : Bool) := (withFlag r s p o l h m (boolWord ok)).declareLocal view (.word (boolWord ok))
theorem updateExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (s p o l h m : Nat)
    (ok : Bool) (hm : m<R) (pos : 0<m) :
    let pre := withView r s p o l h m ok
    Stmt.eval (n+2) t c pre update = pure (.normal (if ok then withView r s p o m h m ok else withView r s p o l (m-1) m ok)) := by
  let pre := withView r s p o l h m ok
  have read : Expr.eval c pre (.var view) = pure (.word (boolWord ok),pre) := Inv32Guards.readWord _ _ _ _ _ rfl
  have M := Inv32ProductValues.cleanup (localWord "midpoint") c.checked (locals pre) _ hm (show locals pre "midpoint"=some m by rfl)
  dsimp only; unfold update; rw [Inv32Blocks.branch _ _ _ _ _ _ _ ok read]
  cases ok with
  | true =>
    simp only [if_true]
    exact Inv32Assign.scalarCast _ _ _ pre _ "low" l m _ _ _ rfl (evalFormula (w "midpoint") c pre _ (by decide) M)
      (by dsimp [pre,withView,view]; write_comparison)
  | false =>
    simp only [Bool.false_eq_true,if_false]
    have rhs := subValue c.checked (locals pre) (w "midpoint") (literal 1) m 1 hm (by decide) pos M rfl
    exact Inv32Assign.scalarCast _ _ _ pre _ "high" h (m-1) _ _ _ rfl (evalFormula minusOne c pre _ (by decide) rhs)
      (by dsimp [pre,withView,view]; write_comparison)

theorem run (n : Nat) (c : Context) (r : Runtime) (s p o l h : Nat)
    (hs : s<R) (hp : p<R) (ho : o<R) (lh : l<h) (hr : h<R) (chk : c.checked=true) :
    let m := Inv32Midpoint.mid l h
    let ok := Inv32CompareCall.answer m o p s p
    Stmt.eval (n+15) Inv32Dispatch.model.core.table c (range r s p o l h) iteration =
      pure (.normal (if ok then range r s p o m h else range r s p o l (m-1))) := by
  let t := Inv32Dispatch.model.core.table
  let m := Inv32Midpoint.mid l h
  let ok := Inv32CompareCall.answer m o p s p
  have hm : m<R := by dsimp [m,Inv32Midpoint.mid]; omega
  have pm : 0<m := by dsimp [m,Inv32Midpoint.mid]; omega
  let outer := (range r s p o l h).pushScope
  let inside := withMid r s p o l h m
  let flagged := withFlag r s p o l h m (boolWord ok)
  let final := if ok then withView r s p o m h m ok else withView r s p o l (m-1) m ok
  have read := evalFormula Inv32Midpoint.expr c outer _ (by decide)
    (chk ▸ Inv32Midpoint.value (locals outer) l h lh hr rfl rfl)
  have decl := Inv32Hoist.declEval (n+13) t c outer "midpoint" .uint256 Inv32Midpoint.expr.core m read (by rw [Ty.coerceValue?])
  have Z := Inv32Hoist.zeroBool (n+12) t c inside.pushScope flag
  have Q := testExec n c r s p o l h m hs hp ho hm
  have V := Inv32PanicChoice.declareFlag (n+12) t c flagged view flag ok rfl
  have U := updateExec (n+11) t c r s p o l h m ok hm pm
  have seq : Stmt.evalList (n+13) t c inside.pushScope [.varDecl .bool flag none,code,.varDecl .bool view (some (.var flag)),update] =
      pure (.normal final) :=
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Q).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ V).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] U).trans (by rw [Stmt.evalList]))))
  have inner := Inv32Hoist.block _ _ _ _ _ _ seq
  have outer' := Inv32Hoist.block _ _ _ _ _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] inner).trans (by rw [Stmt.evalList])))
  dsimp only
  change Stmt.eval _ _ _ _ iteration = pure (.normal (if ok then _ else _))
  rw [show Stmt.eval (n+15) t c (range r s p o l h) iteration = pure (.normal final.popScope.popScope) from outer']
  dsimp [final]; split <;> rfl
end Inv32RatioStep
