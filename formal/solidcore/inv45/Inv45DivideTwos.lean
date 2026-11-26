import Inv45Factor
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.MulDiv
theorem reduceTwos (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (x y d hi lo rem tw : Nat) (D : d<R) (L : lo<R) (T : tw<R) (pos : 0<tw) (un : c.checked=false) :
    let flipped := ((R-tw)/tw+1)%R
    Stmt.eval (n+3) t c (withFactor r x y d 0 hi lo rem tw) divideTwos.value =
      pure (.normal (withFactor r x y (d/tw) 0 hi (lo/tw) rem flipped)) := by
  let start := withFactor r x y d 0 hi lo rem tw
  let den := withFactor r x y (d/tw) 0 hi lo rem tw
  let low := withFactor r x y (d/tw) 0 hi (lo/tw) rem tw
  let done := withFactor r x y (d/tw) 0 hi (lo/tw) rem (((R-tw)/tw+1)%R)
  let g := v "twos"
  let flipped := twice (op BinaryOp_add (Expr_ternary (equalZero g) zero (div (sub zero g) g)) one)
  have z (s : Runtime) (target : s.lookupLocal? "twos"=some (.word tw)) :
      Inv40.Reads c s (equalZero g).value 0 := by
    simpa only [if_neg (Nat.ne_of_gt pos)] using eqZero (wordVar c s _ _ T target) T
  have D' := divRead (wordVar c start.pushScope "denominator" d D rfl) (wordVar c start.pushScope "twos" tw T rfl) D T pos
  have derivD := Inv32Assign.scalarCast n t c start.pushScope den.pushScope "denominator" d (d/tw) .uintCleanup 256 _ rfl
    (D' _ (by decide)) (by dsimp [start,den];store_div)
  let dval := div (v "denominator") g
  have bD := branchFalse (n+1) t c start.pushScope (assign "denominator" zero) (assign "denominator" dval)
    (equalZero g) (z start.pushScope rfl)
  have setD : Stmt.eval (n+2) t c start.pushScope (guarded "denominator" g dval).value=pure (.normal den.pushScope) := bD.trans derivD
  have L' := divRead (wordVar c den.pushScope "prod0" lo L rfl) (wordVar c den.pushScope "twos" tw T rfl) L T pos
  have derivL := Inv32Assign.scalarCast n t c den.pushScope low.pushScope "prod0" lo (lo/tw) .uintCleanup 256 _ rfl
    (L' _ (by decide)) (by dsimp [den,low];store_div)
  let lval := div (v "prod0") g
  have bL := branchFalse (n+1) t c den.pushScope (assign "prod0" zero) (assign "prod0" lval)
    (equalZero g) (z den.pushScope rfl)
  have setL : Stmt.eval (n+2) t c den.pushScope (guarded "prod0" g lval).value=pure (.normal low.pushScope) := bL.trans derivL
  have expr := flip c low.pushScope tw T pos un rfl
  have setT := Inv32Assign.scalarCast (n+1) t c low.pushScope done.pushScope "twos" tw _ .uintCleanup 256 _ rfl
    (expr _ (by decide)) (by dsimp [low,done];store_div)
  change Stmt.eval (n+2) t c low.pushScope (assign "twos" flipped).value = _ at setT
  change Stmt.eval (n+3) t c start divideTwos.value=pure (.normal done)
  dsimp only [g,dval] at setD;dsimp only [g,lval] at setL;dsimp only [flipped,g] at setT
  rw [show divideTwos.value=.block [_,_,_] from rfl,Stmt.eval];dsimp only
  rw [Stmt.evalList,setD];simp only [Inv08.Authority.bindPure]
  rw [Stmt.evalList,setL];simp only [Inv08.Authority.bindPure]
  rw [Stmt.evalList,setT];simp only [Inv08.Authority.bindPure,Stmt.evalList];rfl
end Inv45.MulDiv
