import Inv45MulExpressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies Inv08.Authority
namespace Inv45.MulDiv
def registers (r : Runtime) (hi lo : Nat) := r.withFrame [("prod1",.word hi),("prod0",.word lo)]
def scratch (r : Runtime) (hi lo mm : Nat) := (registers r hi lo).withFrame [("mm",.word mm)]
macro "store_mul" : tactic => `(tactic|
  simp [scratch,registers, Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame, Runtime.assignLocalRaw?,
    LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem readAll (c : Context) (r : Runtime) : Inv40.Reads c r (twice (negBits zero)).value (R-1) := by
  intro n enough;apply Inv32Product.largest.sound n c r (Inv32Actions.locals r) _ (by change 4≤n at enough;change 4≤n;omega)
  · intro k x h;cases e : r.lookupLocal? k <;> simp_all [Inv32Actions.locals]
    rename_i item;cases item <;> simp_all
  · exact Inv32ProductValues.maxRun _ _
theorem eqZero {c r e a} (E : Inv40.Reads c r (e : Pattern Source.Expr).value a) (fit : a<R) :
    Inv40.Reads c r (equalZero e).value (if a=0 then 1 else 0) := by
  apply Inv08.ReleaseQuote.binary E (literal c r 0 (by decide)) .eq (by intro h;cases h) (by intro h;cases h)
  exact Inv32WideGuards.eqWord _ _ _ fit (by decide)
theorem branchFalse (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (yes no : Pattern Source.Stmt) (cond : Pattern Source.Expr)
    (h : Inv40.Reads c r cond.value 0) :
    Stmt.eval (n+1) t c r (.ifElse cond.value yes.value no.value)=Stmt.eval n t c r no.value :=
  Inv32Blocks.branch n t c r cond.value _ _ false (h _ (by omega))
theorem evalProductBlock (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (x y : Nat) (X : r.lookupLocal? "x" = some (.word x)) (Y : r.lookupLocal? "y" = some (.word y))
    (A : x<R) (B : y<R) (un : c.checked=false) :
    Stmt.eval (n+3) t c (registers r 0 0) productBlock.value = pure (.normal (registers r (x*y/R) (x*y%R))) := by
  let m := x*y%(R-1)
  let l := x*y%R
  let h := x*y/R
  have mf : m<R := lt_trans (Nat.mod_lt _ (by decide)) (by decide)
  have lf : l<R := Nat.mod_lt _ (by decide)
  have xR (hi lo mm : Nat) := wordVar c (scratch r hi lo mm) "x" x A (by exact X)
  have yR (hi lo mm : Nat) := wordVar c (scratch r hi lo mm) "y" y B (by exact Y)
  have e := eqZero (readAll c (scratch r 0 0 0)) (by decide)
  rw [if_neg (by decide : R-1 ≠ 0)] at e
  let modExpr := clean (Expr_mulMod (v "x") (v "y") (twice (negBits zero)))
  have M := remainderRead (xR 0 0 0) (yR 0 0 0) (readAll c _) A B (by decide) (by decide)
  have mset := Inv32Assign.scalarCast n t c (scratch r 0 0 0) (scratch r 0 0 m) "mm" 0 m .uintCleanup 256 _ rfl
    (M _ (by decide)) (by store_mul)
  have choose := branchFalse (n+1) t c (scratch r 0 0 0) (assign "mm" zero) (assign "mm" modExpr)
    (equalZero (twice (negBits zero))) e
  have P := productRead (xR 0 0 m) (yR 0 0 m) A B un
  have lset := Inv32Assign.scalarCast (n+1) t c (scratch r 0 0 m) (scratch r 0 l m) "prod0" 0 l .uintCleanup 256 _ rfl
    (P _ (by decide)) (by store_mul)
  have mm := wordVar c (scratch r 0 l m) "mm" m mf rfl
  have low := wordVar c (scratch r 0 l m) "prod0" l lf rfl
  let isLt := op BinaryOp_lt (v "mm") (v "prod0")
  have cmp : Inv40.Reads c (scratch r 0 l m) isLt.value (boolWord (decide (m<l))) := by
    apply Inv08.ReleaseQuote.binary mm low .lt (by intro h;cases h) (by intro h;cases h)
    simpa [boolWord] using Inv32QuoteExpr.lt c.checked _ _ mf lf
  have correction := conditionalWord cmp
  have f0 := diffRead mm low mf lf un
  have f1 := diffRead f0 correction (Nat.mod_lt _ (by decide)) (by unfold boolWord;split <;> decide) un
  have arith : ((m+R-l)%R+R-boolWord (decide (m<l)))%R=h := by simpa [boolWord,m,l,h] using recover x y A B
  rw [arith] at f1
  have hset := Inv32Assign.scalarCast (n+1) t c (scratch r 0 l m) (scratch r h l m) "prod1" 0 h .uintCleanup 256 _ rfl
    (f1 _ (by decide)) (by store_mul)
  have decl0 : Stmt.eval (n+2) t c (registers r 0 0).pushScope (.varDecl .uint256 "mm" none) = pure (.normal (scratch r 0 0 0)) := Inv32FloorStart.zero (n+1) t c _ "mm"
  rw [show productBlock.value=.block [(.varDecl .uint256 "mm" none),_,_,_] from rfl,Stmt.eval];dsimp only
  rw [Stmt.evalList,decl0];simp only [bindPure]
  have chosen : Stmt.eval (n+2) t c (scratch r 0 0 0) (guarded "mm" (twice (negBits zero)) modExpr).value=pure (.normal (scratch r 0 0 m)) := choose.trans mset
  change Stmt.eval (n+2) t c (scratch r 0 0 m) (assign "prod0" (mul (v "x") (v "y"))).value=_ at lset
  change Stmt.eval (n+2) t c (scratch r 0 l m) (assign "prod1" (sub (sub (v "mm") (v "prod0")) (testWord isLt))).value=_ at hset
  dsimp only [modExpr] at chosen
  dsimp only [isLt] at hset
  rw [Stmt.evalList,chosen];simp only [bindPure]
  rw [Stmt.evalList,lset];simp only [bindPure]
  rw [Stmt.evalList,hset];simp only [bindPure,Stmt.evalList];rfl
end Inv45.MulDiv
