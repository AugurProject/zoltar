import Inv32WrapperExec
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv32CompareProducts
inductive Part | first | second | right
def high : Part → String | .first => "firstHigh" | .second => "secondHigh" | .right => "rightHigh"
def low : Part → String | .first => "firstLow" | .second => "secondLow" | .right => "rightLow"
def xName : Part → String | .right => "rightMultiplier" | _ => "multiplier"
def yName : Part → String | .first => "first" | .second => "second" | .right => "rightValue"
def steps (p : Part) : List Stmt := [
  .varDecl .uint256 (high p) none,.varDecl .uint256 (low p) none,
  temp av (xName p),temp bv' (yName p),.varDecl .uint256 hi none,.varDecl .uint256 lo none,
  .captureReturn [hi,lo] (.internalCall [hi,lo] Inv32Bodies.Mul512.key [.var av,.var bv']),
  .assign (.var (high p)) (.var hi),.assign (.var (low p)) (.var lo)]
def slots (p : Part) (x y highV lowV highT lowT : Nat) : Frame :=
  [(lo,.word lowT),(hi,.word highT),(bv',.word y),(av,.word x),(low p,.word lowV),(high p,.word highV)]
def products (p : Part) (x y : Nat) := slots p x y (x*y/R) (x*y%R) (x*y/R) (x*y%R)
def ss := match Inv32Bodies.Comparison.body with | .block [_,_,_,_,_,_,.block s] => s | _ => []
theorem location : ss.take 27 = steps .first ++ steps .second ++ steps .right := by rfl
set_option maxRecDepth 12000
macro "store_product" : tactic => `(tactic|
  simp [slots,high,low,xName,yName,hi,lo,av,bv',Runtime.withFrame,Runtime.pushScope,Runtime.assignNamedValuesRef?,
    Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,
    LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem execute (n : Nat) (c : Context) (r : Runtime) (frame : Frame) (p : Part) (x y : Nat)
    (hx : x<R) (hy : y<R) (X : (r.withFrame frame).lookupLocal? (xName p) = some (.word x))
    (Y : (r.withFrame frame).lookupLocal? (yName p) = some (.word y)) (tail : List Stmt) (enough : 6≤n) :
    Stmt.evalList (n+2) Inv32Dispatch.model.core.table c (r.withFrame frame) (steps p ++ tail) =
    Stmt.evalList (n+2) Inv32Dispatch.model.core.table c (r.withFrame (products p x y ++ frame)) tail := by
  let t := Inv32Dispatch.model.core.table
  let r0 := r.withFrame frame
  let r1 := r0.declareLocal (high p) (.word 0)
  let r2 := r1.declareLocal (low p) (.word 0)
  let r3 := r2.declareLocal av (.word x)
  let r4 := r3.declareLocal bv' (.word y)
  let r5 := r4.declareLocal hi (.word 0)
  let r6 := r5.declareLocal lo (.word 0)
  let st := fun a b v w => r.withFrame (slots p x y a b v w ++ frame)
  let h := x*y/R
  let l := x*y%R
  have xv : r2.lookupLocal? (xName p) = some (.word x) := by cases p <;> exact X
  have yv : r3.lookupLocal? (yName p) = some (.word y) := by cases p <;> exact Y
  have cap := Inv32Temps.captured n c r6 (st 0 0 h l) av bv' hi lo x y hx hy rfl rfl
    (by cases p <;> dsimp [st,r6,r5,r4,r3,r2,r1,r0,h,l] <;> store_product) enough
  have H := Inv32Temps.copy (n+1) t c (st 0 0 h l) (st h 0 h l) (high p) hi 0 h
    (by cases p <;> rfl) rfl (by cases p <;> dsimp [st] <;> store_product)
  have L := Inv32Temps.copy (n+1) t c (st h 0 h l) (st h l h l) (low p) lo 0 l
    (by cases p <;> rfl) rfl (by cases p <;> dsimp [st] <;> store_product)
  refine (seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp _ _ _ _ _ _ _ hx xv)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp _ _ _ _ _ _ _ hy yv)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ cap).trans ?_
  refine (seqStep _ _ _ _ _ _ _ H).trans ?_
  exact seqStep _ _ _ _ _ _ _ L
end Inv32CompareProducts
