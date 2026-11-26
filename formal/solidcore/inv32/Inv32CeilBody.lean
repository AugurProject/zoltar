import Inv32Exit
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32CeilFlags Inv32Exit
namespace Inv32CeilBody
def flagExpr := Inv32Product.clean (Inv32Scalar.cast .uint 256 (Inv32Scalar.localWord h1))
def flagsDone (r : Runtime) (x y d : Nat) := Inv32OneArg.store (Inv32OneArg.store (base r x y d) h0 1)
  h1 (boolWord (hasRemainder x y d))
def afterCast (r : Runtime) (x y d : Nat) := (flagsDone r x y d).declareLocal h3 (.word (boolWord (hasRemainder x y d)))
def w (s : String) := (Inv32Product.clean (Inv32Scalar.localWord s)).core
def floor := Inv32FloorHoist.code h2 (w "x") (w "y") (w "denominator")
theorem shape : ss = [.varDecl .bool h0 none,first,.varDecl .uint256 h1 none,second,
    .varDecl .uint256 h3 (some flagExpr.core),.varDecl .uint256 h2 none,floor,Inv32CeilAdd.ret] := by rfl
def ceilResult (x y d : Nat) : Option Nat := let k := (x*y+d-1)/d; if k<R then some k else none
theorem amount (x y d : Nat) (hp : 0<d) : (x*y+d-1)/d = x*y/d + boolWord (hasRemainder x y d) := by
  rw [←Inv32Rounding.ceil_identity _ _ hp]; simp [boolWord,hasRemainder]
private theorem cleanRead (c : Context) (r : Runtime) (s : String) (v : Nat) (hv : v<R)
    (h : r.lookupLocal? s = some (.word v)) : Expr.eval c r (w s) = pure (.word v,r) :=
  Inv32Guards.clean _ _ _ _ _ hv (Inv32Guards.readWord _ _ _ _ _ h)
theorem lower (n : Nat) (c : Context) (r : Runtime) (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d)
    (ch : c.checked=true) : Terminates r (words (ceilResult x y d))
      (Stmt.evalList (n+25) Inv32Dispatch.model.core.table c (Inv32OneArg.store (afterCast r x y d) h2 0) [floor,Inv32CeilAdd.ret]) := by
  let t := Inv32Dispatch.model.core.table
  let root := afterCast r x y d
  let q := x*y/d
  let b := boolWord (hasRemainder x y d)
  have br : b<R := by dsimp [b]; cases hasRemainder x y d <;> decide
  have inputs : Inv32FloorHoist.Inputs c root h2 (w "x") (w "y") (w "denominator") x y d :=
    ⟨cleanRead _ _ _ _ hx rfl,cleanRead _ _ _ _ hy rfl,cleanRead _ _ _ _ hd rfl⟩
  unfold ceilResult; rw [amount _ _ _ hp]
  by_cases qr : q<R
  · have Q := Inv32FloorHoist.success (n+10) c root h2 _ _ _ x y d hx hy hd hp qr inputs (by decide) (by decide) (by decide) (by decide)
    let next := Inv32OneArg.store root h2 q
    refine pass _ _ _ _ _ _ _ _ _ Q ?_
    by_cases fit : q+b<R
    · rw [if_pos fit]
      exact stop _ _ _ _ _ _ [] _ (show Terminates r (some [.word (q+b)]) _ from
        ⟨next,fun _ => rfl,Inv32CeilAdd.good (n+24) t c next q b qr br fit ch rfl rfl⟩)
    · rw [if_neg fit]
      exact stop _ _ _ _ _ _ [] _ (show Terminates r none _ from
        ⟨next,.overflow,Inv32CeilAdd.bad (n+24) t c next q b qr br (Nat.le_of_not_gt fit) ch rfl rfl⟩)
  · have big : ¬q+b<R := by omega
    rw [if_neg big]
    exact stop _ _ _ _ _ _ _ _ (show Terminates r none _ from Inv32FloorHoist.overflow n c root h2 _ _ _ x y d hx hy hd hp (Nat.le_of_not_gt qr) inputs)

theorem runFlags (n : Nat) (c : Context) (r : Runtime) (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d)
    (ch : c.checked=true) : Terminates r (words (ceilResult x y d))
       (Stmt.evalList (n+25) Inv32Dispatch.model.core.table c (base r x y d) ss) := by
  let t := Inv32Dispatch.model.core.table
  let root := base r x y d
  let stage1 := Inv32OneArg.store root h0 1
  let st := flagsDone r x y d
  let b := hasRemainder x y d
  have z1 := Inv32Hoist.zeroBool (n+24) t c root h0
  have F1 := firstStep (n+19) c r x y d
  have z2 := Inv32FloorStart.zero (n+24) t c stage1 h1
  have F2 := secondStep (n+16) c r x y d hx hy hd hp
  have computed (b' : Bool) (checked : Bool) :
      flagExpr.run checked (fun _ => some (boolWord b')) = some (boolWord b') := by cases b' <;> cases checked <;> native_decide
  have read : flagExpr.run c.checked (locals st) = some (boolWord b) := by
    change (do let v ← (Inv32Scalar.cast .uint 256 (Inv32Scalar.localWord h1)).run c.checked (locals st)
               Inv32Scalar.projectWord (uintCleanup? c.checked 256 (.word v))) = _
    exact computed b c.checked
  have cast := Inv32Hoist.declEval (n+24) t c st h3 .uint256 flagExpr.core (boolWord b)
    (evalFormula flagExpr c st _ (by decide) read) (by rw [Ty.coerceValue?])
  have z3 := Inv32FloorStart.zero (n+24) t c (afterCast r x y d) h2
  rw [shape]
  exact pass _ _ _ _ _ _ _ _ _ z1 (pass _ _ _ _ _ _ _ _ _ F1 (pass _ _ _ _ _ _ _ _ _ z2
    (pass _ _ _ _ _ _ _ _ _ F2 (pass _ _ _ _ _ _ _ _ _ cast (pass _ _ _ _ _ _ _ _ _ z3 (lower _ _ _ _ _ _ hx hy hd hp ch))))))
end Inv32CeilBody
