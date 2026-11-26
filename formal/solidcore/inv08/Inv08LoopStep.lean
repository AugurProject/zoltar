import Inv08SearchExpressions
import Inv32RatioStep

open SolidCore.Solidity.Source Inv32Actions Inv32Division
namespace Inv08.Expiry
def entry (r : Runtime) (time : Nat) := r.withFrame [("timestamp",.word time),("_ret0",.word 0)]
def start (r : Runtime) (time : Nat) := (entry r time).pushScope.pushScope
def withHigh (r : Runtime) (time high : Nat) := (start r time).declareLocal "high" (.word high)
def range (r : Runtime) (time lo hi : Nat) := (withHigh r time hi).declareLocal "low" (.word lo)
def withMid (r : Runtime) (time lo hi mid : Nat) := (range r time lo hi).pushScope.declareLocal "middle" (.word mid)
def withEnd (r : Runtime) (time lo hi mid expiry : Nat) := (withMid r time lo hi mid).pushScope.declareLocal "#read774" (.word expiry)
macro "write_expiry" : tactic => `(tactic|
  simp [withEnd,withMid,range,withHigh,start,entry,Runtime.assignLocal?,Runtime.lookupLocal?,
    Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,
    Frame.lookup?,Frame.assign?,Value.coerceLike?])

theorem decrementEval (c : Context) (r : Runtime) (m : Nat) (pos : 0<m) (fit : m<2^48)
    (M : locals r "middle"=some m) : decrement.value.eval c r = pure (.word (m-1),r) := by
  let expr := minus (namedWord "middle") (constant 1)
  have mW := narrow (term:=Inv32Scalar.localWord "middle") (checked:=c.checked) (env:=locals r) fit M
  have one : (constant 1).run c.checked (locals r)=some 1 := by cases c.checked <;> rfl
  have sub : expr.run c.checked (locals r)=some (m-1) := by
    apply narrow2 (by omega : m-1<2^48)
    simp [Inv32Product.subF,Inv32Scalar.binary,namedWord,mW,one,
      Inv32QuoteExpr.subWord _ m 1 (lt_trans fit (by decide)) (by decide) pos,Inv32Scalar.projectWord]
  exact evalFormula expr c r _ (by decide) sub

theorem step (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (time lo hi last : Nat) (ends : Nat → Nat)
    (ch : c.checked=true) (tf : time<2^48) (pos : 0<lo) (run : lo<hi) (hf : hi<2^48) (bound : hi≤last)
    (endBound : ∀ i, i≤last → ends i<2^48) (records : EndTable c r.state ends last) :
    let m := middle lo hi
    Stmt.eval (n+5) t c (range r time lo hi) iteration.value =
      pure (.normal (if ends m ≤ time then range r time m hi else range r time lo (m-1))) := by
  let m := middle lo hi
  have midBounds : lo<m ∧ m≤hi := by dsimp [m,middle]; omega
  have mf : m<2^48 := by omega
  let d := ends m
  have ef : d<2^48 := endBound _ (by omega)
  let inner := withMid r time lo hi m
  let tested := withEnd r time lo hi m d
  have M : midpoint.value.eval c (range r time lo hi).pushScope = pure (.word m,(range r time lo hi).pushScope) := by
    rw [shape]
    apply evalFormula _ _ _ _ (by decide)
    rw [ch]
    exact computes _ _ _ pos run hf rfl rfl
  have D := Inv32Hoist.declEval (n+3) t c (range r time lo hi).pushScope "middle" .uint256 _ m M (by rfl)
  have probe := readEnd c inner.pushScope "middle" m d rfl (records _ _ rfl (by omega))
  have E := Inv32Hoist.declEval (n+2) t c inner.pushScope "#read774" .uint256 _ d (cleaned probe ef _ (Nat.le_succ _)) (by rfl)
  have T := leEval c tested "#read774" "timestamp" d time ef tf rfl rfl
  let final := if d≤time then withEnd r time m hi m d else withEnd r time lo (m-1) m d
  have branch : Stmt.eval (n+3) t c tested update.value = pure (.normal final) := by
    change Stmt.eval (n+3) t c tested (.ifElse past.value (Inv03.Bodies.assign "low" (w48 "middle")).value (Inv03.Bodies.assign "high" decrement).value) = _
    refine (Inv32Blocks.branch (n+2) t c tested past.value _ _ (decide (d≤time)) T).trans ?_
    by_cases ok : d≤time
    · simp only [decide_eq_true ok,if_true,if_pos ok,final]
      exact Inv32Assign.scalarCast _ _ _ tested _ "low" lo m _ _ _ rfl
        (local48 _ _ _ _ mf (by rfl) _ (Nat.le_succ _)) (by dsimp [tested]; write_expiry)
    · simp only [decide_eq_false ok,Bool.false_eq_true,if_false,if_neg ok,final]
      exact Inv32Assign.scalarCast _ _ _ tested _ "high" hi (m-1) _ _ _ rfl
        (decrementEval c tested m (by omega) mf rfl) (by dsimp [tested]; write_expiry)
  have nested := Inv32Hoist.block _ _ _ inner _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ E).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] branch).trans (by rw [Stmt.evalList])))
  have outer := Inv32Hoist.block _ _ _ (range r time lo hi) _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ D).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] nested).trans (by rw [Stmt.evalList])))
  change Stmt.eval _ _ _ _ iteration.value = _
  rw [show Stmt.eval (n+5) t c (range r time lo hi) iteration.value = pure (.normal final.popScope.popScope) from outer]
  dsimp [final,d,m]; split <;> rfl
end Inv08.Expiry
