import Inv45Product
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.MulDiv
def arguments (r : Runtime) (x y d result : Nat) :=
  r.withFrame [("x",.word x),("y",.word y),("denominator",.word d),("result",.word result)]
def outer (r : Runtime) (x y d result : Nat) := (arguments r x y d result).pushScope.pushScope
def fields (hi lo : Nat) : Frame := [("prod1",.word hi),("prod0",.word lo)]
def remFields (hi lo rem : Nat) : Frame := ("remainder",.word rem)::fields hi lo
def factorFields (hi lo rem tw : Nat) := ("twos",Value.word tw)::remFields hi lo rem
def withRem (r : Runtime) (x y d result hi lo rem : Nat) :=
  (outer r x y d result).withFrame (remFields hi lo rem)
def withFactor (r : Runtime) (x y d result hi lo rem tw : Nat) :=
  (outer r x y d result).withFrame (factorFields hi lo rem tw)
macro "store_div" : tactic => `(tactic|
  simp [withFactor,withRem,factorFields,remFields,fields,outer,arguments,
    Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.pushScope,Runtime.withFrame,
    LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem denNonzero (c : Context) (r : Runtime) (d : Nat) (positive : 0<d) (D : d<R)
    (located : r.lookupLocal? "denominator"=some (.word d)) : Inv40.Reads c r (equalZero (v "denominator")).value 0 := by
  have z := eqZero (wordVar c r _ _ D located) D
  simpa only [if_neg (Nat.ne_of_gt positive)] using z
theorem divRead {c r l m a b} (L : Inv40.Reads c r (l : Pattern Source.Expr).value a)
    (M : Inv40.Reads c r (m : Pattern Source.Expr).value b) (A : a<R) (B : b<R) (positive : 0<b) :
    Inv40.Reads c r (div l m).value (a/b) := by
  apply twiceReads _ (lt_of_le_of_lt (Nat.div_le_self _ _) A)
  exact Inv08.ReleaseQuote.binary L M .div (by intro h;cases h) (by intro h;cases h) (Inv32Eval.divideWords _ _ _ A B positive)
theorem evalBorrow (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (x y d hi lo : Nat) (X : x<R) (Y : y<R) (D : d<R) (positive : 0<d)
    (H : hi<R) (wide : 0<hi) (L : lo<R) (un : c.checked=false) :
    let rem := x*y%d
    let top := hi-(if lo<rem then 1 else 0)
    Stmt.eval (n+3) t c (withRem r x y d 0 hi lo 0) remainderBlock.value =
      pure (.normal (withRem r x y d 0 top ((lo+R-rem)%R) rem)) := by
  let m := x*y%d
  let top := hi-(if lo<m then 1 else 0)
  let low := (lo+R-m)%R
  let start := withRem r x y d 0 hi lo 0
  let rm := withRem r x y d 0 hi lo m
  let high := withRem r x y d 0 top lo m
  let done := withRem r x y d 0 top low m
  have fit : m<R := lt_trans (Nat.mod_lt _ positive) D
  have M := remainderRead (l:=varP "x") (m:=varP "y") (dst:=varP "denominator")
    (Inv08.localReads c start.pushScope "x" x rfl) (Inv08.localReads c start.pushScope "y" y rfl)
    (Inv08.localReads c start.pushScope "denominator" d rfl) X Y D positive
  let remainder := clean (Expr_mulMod (varP "x") (varP "y") (varP "denominator"))
  have mset := Inv32Assign.scalarCast n t c start.pushScope rm.pushScope "remainder" 0 m .uintCleanup 256 _ rfl
    (M _ (by decide)) (by dsimp [start,rm];store_div)
  have branch := branchFalse (n+1) t c start.pushScope (assign "remainder" zero) (assign "remainder" remainder)
    (equalZero (v "denominator")) (denNonzero c _ d positive D rfl)
  have choose : Stmt.eval (n+2) t c start.pushScope (guarded "remainder" (v "denominator") remainder).value=
      pure (.normal rm.pushScope) := branch.trans mset
  let larger := op BinaryOp_gt (v "remainder") (v "prod0")
  have cmp : Inv40.Reads c rm.pushScope larger.value (boolWord (decide (lo<m))) := by
    apply Inv08.ReleaseQuote.binary (wordVar c _ _ _ fit rfl) (wordVar c _ _ _ L rfl) .gt
      (by intro h;cases h) (by intro h;cases h)
    simpa [boolWord] using Inv32QuoteExpr.gt c.checked m lo fit L
  have B := diffRead (wordVar c rm.pushScope "prod1" hi H rfl) (conditionalWord cmp) H
    (by unfold boolWord;split <;> decide) un
  have bounded : (hi+R-boolWord (decide (lo<m)))%R=top := by
    dsimp [top,boolWord]
    by_cases b : lo<m
    · simp only [b,decide_true,if_true]
      rw [show hi+R-1=(hi-1)+R by omega,Nat.add_mod_right,Nat.mod_eq_of_lt (by omega)]
    · simp only [b,decide_false,Bool.false_eq_true,if_false,Nat.sub_zero,Nat.add_mod_right,Nat.mod_eq_of_lt H]
  rw [bounded] at B
  have T := Inv32Assign.scalarCast (n+1) t c rm.pushScope high.pushScope "prod1" hi top .uintCleanup 256 _ rfl
    (B _ (by decide)) (by dsimp [rm,high];store_div)
  have G := diffRead (wordVar c high.pushScope "prod0" lo L rfl) (wordVar c high.pushScope "remainder" m fit rfl) L fit un
  have F := Inv32Assign.scalarCast (n+1) t c high.pushScope done.pushScope "prod0" lo low .uintCleanup 256 _ rfl
    (G _ (by decide)) (by dsimp [high,done];store_div)
  change Stmt.eval (n+2) t c rm.pushScope (assign "prod1" (sub (v "prod1") (testWord larger))).value=_ at T
  change Stmt.eval (n+2) t c high.pushScope (assign "prod0" (sub (v "prod0") (v "remainder"))).value=_ at F
  dsimp only [larger] at T;dsimp only [remainder] at choose
  change Stmt.eval (n+3) t c start remainderBlock.value=pure (.normal done)
  rw [show remainderBlock.value=.block [_,_,_] from rfl,Stmt.eval];dsimp only
  rw [Stmt.evalList,choose];simp only [Inv08.Authority.bindPure]
  rw [Stmt.evalList,T];simp only [Inv08.Authority.bindPure]
  rw [Stmt.evalList,F];simp only [Inv08.Authority.bindPure,Stmt.evalList];rfl
end Inv45.MulDiv
