import Inv32OneArg
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions
namespace Inv32CeilFlags
abbrev rUp := "_ret___library_Math_unsignedRoundsUp_0"
abbrev toU := "_ret___library_SafeCast_toUint_0"
abbrev h0 := "_sol_hoist_0"
abbrev h1 := "_sol_hoist_1"
abbrev h2 := "_sol_hoist_2"
abbrev h3 := "_sol_hoist_3"
def base (r : Runtime) (x y d : Nat) :=
  (r.withFrame [("x",.word x),("y",.word y),("denominator",.word d),("rounding",.word 1),("_ret0",.word 0)]).pushScope.pushScope
def first := Inv32OneArg.code h0 rUp Inv32Bodies.RoundsUp.key .uint256 .bool (.var "rounding")
def condR := Inv32WideGuards.gtF (clean Inv32Borrow.productMod) (literal 0)
def test : Expr := .binary .boolAnd (.var h0) condR.core
def second := Inv32OneArg.code h1 toU Inv32Bodies.ToUint.key .bool .uint256 test
def hasRemainder (x y d : Nat) := decide (0 < x*y%d)
def ss := match Inv32Bodies.Ceil.body with | .block [_,_,_,_,_,.block stmts] => stmts | _ => []
theorem begins : ss.take 4 = [.varDecl .bool h0 none,first,.varDecl .uint256 h1 none,second] := by rfl

theorem firstStep (n : Nat) (c : Context) (r : Runtime) (x y d : Nat) :
    let root := base r x y d
    Stmt.eval (n+6) Inv32Dispatch.model.core.table c (Inv32OneArg.store root h0 0) first =
      pure (.normal (Inv32OneArg.store root h0 1)) := by
  let rt := base r x y d
  apply Inv32OneArg.execute (n+3) _ _ rt _ _ _ _ _ _ 1 1 (by decide) (by decide) (by decide)
  · rw [Ty.coerceValue?]
  · rw [Ty.defaultValue]
  · exact Inv32Guards.readWord _ _ _ _ _ rfl
  · exact Inv32FlagCalls.roundsUp n c _ _ _ (1 : Fin 4) rfl

private theorem modRun (ctx : Bool) (env : Env) (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R)
    (hp : 0<d) (X : env "x" = some x) (Y : env "y" = some y) (D : env "denominator" = some d) :
    condR.run ctx env = some (boolWord (hasRemainder x y d)) := by
  have m : Inv32Borrow.productMod.run ctx env = some (x*y%d) := Inv32Borrow.modValue _ _ _ _ hx hy hd hp X Y D
  have mr := lt_trans (Nat.mod_lt (x*y) hp) hd
  have cl := Inv32ProductValues.cleanup _ ctx env _ mr m
  have gt : BinaryOp.apply ctx .gt (.word (x*y%d)) (.word 0) = .ok (.word (if 0<x*y%d then 1 else 0)) :=
    Inv32WideGuards.gtWord _ _ mr (by decide)
  simp [condR,Inv32WideGuards.gtF,binary,cl,literal,show normWord 0 = 0 by decide,gt,projectWord,hasRemainder,boolWord]
theorem testValue (c : Context) (r : Runtime) (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d)
    (X : locals r "x" = some x) (Y : locals r "y" = some y) (D : locals r "denominator" = some d)
    (flag : r.lookupLocal? h0 = some (.word 1)) :
    Expr.eval c r test = pure (.word (boolWord (hasRemainder x y d)),r) := by
  have model : Models r (locals r) := by
    intro k v h; cases H : r.lookupLocal? k with
    | none => simp [locals,H] at h
    | some val => cases val <;> simp_all [locals]
  have right := condR.sound (test.orderFuel) c r (locals r) _ (by decide) model (modRun _ _ _ _ _ hx hy hd hp X Y D)
  have left : Expr.evalFuel test.orderFuel c r (.var h0) = pure (.word 1,r) := Inv32Guards.readWord _ _ _ _ _ flag
  unfold test at left
  unfold Expr.eval test; rw [Expr.evalFuel,left]
  change (do let (v,s) ← Expr.evalFuel test.orderFuel c r condR.core; let w ← liftM v.expectWord
             pure (Value.word (boolWord (wordTruthy w)),s)) = _
  rw [right]; cases hasRemainder x y d <;> rfl

theorem secondStep (n : Nat) (c : Context) (r : Runtime) (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d) :
    let root := Inv32OneArg.store (base r x y d) h0 1
    Stmt.eval (n+9) Inv32Dispatch.model.core.table c (Inv32OneArg.store root h1 0) second =
      pure (.normal (Inv32OneArg.store root h1 (boolWord (hasRemainder x y d)))) := by
  let rt := Inv32OneArg.store (base r x y d) h0 1
  let bit := hasRemainder x y d
  apply Inv32OneArg.execute (n+6) _ _ rt _ _ _ _ _ _ (boolWord bit) (boolWord bit) (by decide) (by decide) (by decide)
  · exact Inv32Hoist.boolCoerce _
  · rw [Ty.defaultValue]
  · exact testValue _ _ _ _ _ hx hy hd hp rfl rfl rfl rfl
  · exact Inv32FlagCalls.toUint n c _ _ _ bit rfl
end Inv32CeilFlags
