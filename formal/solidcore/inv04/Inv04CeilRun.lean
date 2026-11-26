import Inv04CeilEval
import Inv04Shapes
import Inv32CompareValues
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Scalar Inv32QuoteExpr Inv32FloorStart Inv32FloorFastPath
namespace Inv04.Ceil

def frame (x : Nat) : Frame := [("a",.word x),("b",.word (10^9)),("_ret0",.word 0)]
def mul := Inv32NewtonBody.twice (Inv32Product.mulF (castCopy "_sol_hoist_0") (w "_sol_hoist_1"))

theorem productValue (x : Nat) (small : x<R) (env : Env)
    (A : env "_sol_hoist_0" = some (boolWord (decide (0<x))))
    (B : env "_sol_hoist_1" = some (predWord x/(10^9)+1)) :
    mul.run false env = some (Inv03.ceilQuot x (10^9)) := by
  let a := boolWord (decide (0<x))
  let b := predWord x/(10^9)+1
  have ha : a<R := by dsimp [a]; cases decide (0<x) <;> decide
  have hb : b<R := (scaledFactor x small).1
  have one : a = if x=0 then 0 else 1 := by cases x <;> simp [a,boolWord]
  have value : a*b = Inv03.ceilQuot x (10^9) := one ▸ (scaledFactor x small).2
  have fits : a*b<R := by rw [one]; split <;> simp only [Nat.zero_mul,Nat.one_mul] <;> first | exact hb | decide
  have m := Inv32Execution.mul (bv a) (bv b)
  simp only [BitVec.toNat_mul,BitVec.toNat_ofNat,Nat.mod_eq_of_lt ha,Nat.mod_eq_of_lt hb,Nat.mod_eq_of_lt fits] at m
  have op : BinaryOp.apply false .mul (.word a) (.word b) = .ok (.word (a*b)) := by
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,m,Bind.bind,Except.bind]
  rw [←value]
  apply Inv32ProductValues.cleanup _ _ _ _ fits; apply Inv32ProductValues.cleanup _ _ _ _ fits
  have X := castValue false env "_sol_hoist_0" a ha A
  have Y := Inv32ProductValues.cleanup (localWord "_sol_hoist_1") false env b hb B
  simp [Inv32Product.mulF,binary,w,X,Y,op,projectWord]

theorem run (n : Nat) (c : Context) (r : Runtime) (x : Nat) (small : x<R) :
    let src := r.withFrame (frame x)
    Stmt.eval (n+13) Inv03.model.core.table c src Shapes.ceilShape.value =
      pure (.returned src [.word (Inv03.ceilQuot x (10^9))]) := by
  let t := Inv03.model.core.table
  let src := r.withFrame (frame x)
  let outer := src.pushScope
  let inner := outer.pushScope
  let pre := inner.pushScope
  let ctx := {c with checked := false}
  let bit := decide (0<x)
  let f := predWord x/(10^9)+1
  let first := pre.declareLocal "_sol_hoist_1" (.word f)
  let last := Inv32OneArg.store first "_sol_hoist_0" (boolWord bit)
  have dec := Inv32Hoist.declEval (n+8) t ctx pre "_sol_hoist_1" .uint256 add.core f
    (evalFormula add ctx pre f (by decide) (addValue _ small _ rfl rfl)) (by rw [Ty.coerceValue?])
  have conv : Stmt.eval (n+9) t ctx (Inv32OneArg.store first "_sol_hoist_0" 0) Shapes.convert.value =
      pure (.normal last) := by
    apply Inv32OneArg.execute (n+6) t ctx first "_sol_hoist_0" Inv32CeilFlags.toU Inv32Bodies.ToUint.key
      .bool .uint256 (positive "a").core (boolWord bit) (boolWord bit) (by decide) (by decide) (by decide)
    · exact Inv32Hoist.boolCoerce _
    · rw [Ty.defaultValue]
    · exact evalFormula (positive "a") _ _ _ (by decide) (positiveValue _ _ _ _ small rfl)
    · exact Inv32FlagCalls.toUintAt t Inv03.uintLinked n ctx _ _ _ bit rfl
  have ret := Inv32CompareValues.retOne (n+8) t ctx last mul.core (Inv03.ceilQuot x (10^9))
    (evalFormula mul ctx last _ (by decide) (productValue _ small _ rfl rfl))
  let ss : List Stmt := [.varDecl .uint256 "_sol_hoist_1" (some add.core),.varDecl .uint256 "_sol_hoist_0" none,
    Shapes.convert.value,.returnValues [mul.core]]
  have uncheckedBlock : Stmt.eval (n+11) t c inner (.unchecked (.block ss)) =
      pure (.returned inner [.word (Inv03.ceilQuot x (10^9))]) := by
    rw [Stmt.eval]
    apply blockReturned _ _ _ _ last
    exact (seqStep _ _ _ _ _ _ _ dec).trans ((seqStep _ _ _ _ _ _ _ (zero (n+8) t ctx first "_sol_hoist_0")).trans
      ((seqStep _ _ _ _ _ _ _ conv).trans (stop _ _ _ _ _ _ [] _ ret)))
  let cond := (Inv32WideGuards.zeroTest "b").core
  have guard := Inv32Blocks.branch (n+10) t c inner cond Shapes.panic.value .skip false
    (evalFormula (Inv32WideGuards.zeroTest "b") c inner 0 (by decide)
      (Inv32WideGuards.zeroValue c.checked (locals inner) "b" (10^9) (by decide) rfl))
  have sk : Stmt.eval (n+10) t c inner .skip = pure (.normal inner) := by rw [Stmt.eval]
  have main := blockReturned (n+11) t c outer inner _ _ ((seqStep _ _ _ _ _ _ _ (guard.trans sk)).trans
    (stop _ _ _ _ _ _ [] _ uncheckedBlock))
  have a := cleanParamExec (n+11) t c outer "a" x small rfl (by dsimp [outer,src,frame]; write_param)
  have b := cleanParamExec (n+11) t c outer "b" (10^9) (by decide) rfl (by dsimp [outer,src,frame]; write_param)
  have skip : Stmt.eval (n+12) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  apply blockReturned _ _ _ _ outer
  exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ b).trans ((seqStep _ _ _ _ _ _ _ skip).trans
    (stop _ _ _ _ _ _ [] _ main)))
end Inv04.Ceil
