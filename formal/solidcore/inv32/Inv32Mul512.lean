import Inv32High
open SolidCore.Solidity.Source Inv32Scalar Inv32Division Inv32Actions Inv32Product Inv32ProductValues
namespace Inv32Mul512
def frame (a b high low : Nat) : Frame :=
  [("a",.word a),("b",.word b),("high",.word high),("low",.word low)]

private theorem store (name : String) (e : Formula) (sz) (checked : Bool) (r next : Runtime)
    (old v : Nat) (hv : v < R) (existsName : locals r name = some old)
    (rhs : e.run checked (locals r) = some v)
    (updated : r.assignLocal? name (.word v) = some next) :
    (writeCast name .cleanup 256 e sz).run checked r = some next := by
  have cleaned := cleanup e checked (locals r) _ hv rhs
  change (Inv32Scalar.cast .cleanup 256 e).run checked (locals r) = some v at cleaned
  simp [writeCast,existsName,cleaned,updated]

private theorem impossibleBranch (env : Env) :
    (eqF largest (literal 0)).run false env = some 0 := by
  have closed : (eqF largest (literal 0)).run false (fun _ => none) = some 0 := by native_decide
  exact closed

set_option maxRecDepth 10000
macro "write_frame" : tactic => `(tactic|
  simp [Runtime.assignLocal?, Runtime.lookupLocal?, Runtime.withFrame, Runtime.pushScope,
    Frame.lookup?, Frame.assign?, LocalEnv.lookup?, LocalEnv.assign?, frame, Value.coerceLike?])

theorem evaluates (checked : Bool) (r : Runtime) (a b : Nat) (ha : a < R) (hb : b < R) :
    program.run checked (r.withFrame (frame a b 0 0)) =
      some (r.withFrame (frame a b (a*b/R) (a*b%R))) := by
  let outer := (r.withFrame (frame a b 0 0)).pushScope
  let work := fun h l m => {r with locals := [("mm",Value.word m)] :: [] :: [] :: frame a b h l :: r.locals}
  let m := a*b%(R-1)
  let l := a*b%R
  let h := a*b/R
  have hm : m < R := lt_trans (Nat.mod_lt _ (by decide : 0 < R-1)) (by decide)
  have hl : l < R := Nat.mod_lt _ (Nat.two_pow_pos 256)
  have hh : h < R := (Nat.div_lt_iff_lt_mul (Nat.two_pow_pos 256)).mpr
    (Nat.lt_of_le_of_lt (Nat.mul_le_mul_right _ (Nat.le_of_lt ha)) (Nat.mul_lt_mul_of_pos_left hb (by decide)))
  have A := store "a" (localWord "a") (by decide) checked outer outer a a ha rfl rfl (by dsimp [outer]; write_frame)
  have B := store "b" (localWord "b") (by decide) checked outer outer b b hb rfl rfl (by dsimp [outer]; write_frame)
  have M := store "mm" modExpr (by decide) false (work 0 0 0) (work 0 0 m) 0 m hm rfl
    (modResult a b ha hb _ rfl rfl) (by dsimp [work]; write_frame)
  have L := store "low" lowExpr (by decide) false (work 0 0 m) (work 0 l m) 0 l hl rfl
    (lowResult a b ha hb _ rfl rfl) (by dsimp [work]; write_frame)
  have H := store "high" highExpr (by decide) false (work 0 l m) (work h l m) 0 h hh rfl
    (Inv32High.highLimb _ a b ha hb rfl rfl) (by dsimp [work]; write_frame)
  have D : (declareZero "mm").run false outer.pushScope.pushScope = some (work 0 0 0) := by
    change some {r with locals := [("mm",Ty.uint256.defaultValue)] :: [] :: [] :: frame a b 0 0 :: r.locals} = _
    rw [Ty.defaultValue]
  simp only [program, block, runList, noop, unchecked, conditional, impossibleBranch]
  rw [A]
  simp only [Option.bind_some, Option.bind]
  rw [B]
  simp only [Option.bind_some, Option.bind]
  rw [D]
  simp only [bind, Option.bind, show wordTruthy (normWord 0) = false by decide, Bool.false_eq_true, if_false]
  rw [M]
  simp only [Option.bind]
  rw [L]
  simp only [Option.bind]
  rw [H]
  rfl

theorem generatedExecution (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (a b : Nat) (ha : a < R) (hb : b < R) (enough : 6 ≤ fuel) :
    Stmt.eval fuel t c (r.withFrame (frame a b 0 0)) Inv32Bodies.Mul512.body =
      pure (.normal (r.withFrame (frame a b (a*b/R) (a*b%R)))) :=
  execute _ _ _ _ _ enough (evaluates _ _ _ _ ha hb)

end Inv32Mul512
