import Inv48Model
import Inv32FlagCalls
import Inv03Budget
import Inv32CeilCall

open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32CeilFlags Inv32FloorFastPath
namespace Inv48.QuoteExecMath
open Inv48.Source Inv03
variable {table : FunctionTable}
variable (productLinked : Inv32Internal.ProductLinked table)
variable (floorLinked : Inv32FloorCall.FloorLinked table)
variable (roundsLinked : Inv32Library.LinkAt table Inv32Bodies.RoundsUp.key
  [.word "rounding"] [.flag "_ret0"] Inv32Bodies.RoundsUp.body)
variable (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key
  [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body)
variable (roundedLinked : Inv32Library.LinkAt table Inv32Bodies.Ceil.key
  [.word "x",.word "y",.word "denominator",.word "rounding"] [.word "_ret0"] Inv32Bodies.Ceil.body)
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def rounded (x y d : Nat) (up : Bool) :=
  x*y/d + boolWord (up && hasRemainder x y d)

theorem roundedCeil (x y d : Nat) (hp : 0<d) :
    rounded x y d true = ceilQuot (x*y) d := by
  unfold rounded ceilQuot
  rw [Bool.true_and,← Inv32CeilBody.amount _ _ _ hp]
  congr 1
  omega

theorem roundedFloor (x y d : Nat) : rounded x y d false = x*y/d := by
  simp [rounded,boolWord]

private def roundingFrame (x y d : Nat) (up : Bool) : Frame :=
  [("x",.word x),("y",.word y),("denominator",.word d),("rounding",.word (boolWord up)),("_ret0",.word 0)]

include productLinked floorLinked roundsLinked uintLinked
private theorem execute (n : Nat) (c : Context) (r : Runtime) (x y d : Nat) (up : Bool)
    (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d) (ch : c.checked=true) (fits : rounded x y d up<R) :
    let src := r.withFrame (roundingFrame x y d up)
    Stmt.eval (n+17) table c src Inv32Bodies.Ceil.body =
      pure (.returned src [.word (rounded x y d up)]) := by
  let t := table
  let src := r.withFrame (roundingFrame x y d up)
  let outer := src.pushScope
  let root := base r x y d up
  let bit := up && hasRemainder x y d
  let b := boolWord bit
  let q := x*y/d
  let stage1 := Inv32OneArg.store root h0 (boolWord up)
  let stage2 := Inv32OneArg.store stage1 h1 b
  let stage3 := stage2.declareLocal h3 (.word b)
  let final := Inv32OneArg.store stage3 h2 q
  have qb : q<R := lt_of_le_of_lt (Nat.le_add_right q b) fits
  have bb : b<R := by dsimp only [b]; cases bit <;> decide
  have z1 := Inv32Hoist.zeroBool (n+14) t c root h0
  have f1 := firstStepAt t roundsLinked (n+9) c r x y d up
  have z2 := Inv32FloorStart.zero (n+14) t c stage1 h1
  have f2 := secondStepAt t uintLinked (n+6) c r x y d up hx hy hd hp
  have casted := Inv32Hoist.declEval (n+14) t c stage2 h3 .uint256 Inv32CeilBody.flagExpr.core b
    (evalFormula Inv32CeilBody.flagExpr c stage2 b (by decide)
      (by cases h : bit <;> change _ = some (boolWord bit) <;>
          simp only [h] <;> dsimp [stage2,stage1,b] <;> rw [h] <;> cases c.checked <;> rfl))
    (by rw [Ty.coerceValue?])
  have z3 := Inv32FloorStart.zero (n+14) t c stage3 h2
  have inputs : Inv32FloorHoist.Inputs c stage3 h2 (Inv32CeilBody.w "x") (Inv32CeilBody.w "y")
        (Inv32CeilBody.w "denominator") x y d :=
    ⟨Inv32Guards.clean _ _ _ _ _ hx (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hy (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hd (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have f := Inv32FloorHoist.successAt t productLinked floorLinked n c stage3 h2 _ _ _ _ _ _
    hx hy hd hp qb inputs (by decide) (by decide) (by decide) (by decide)
  have exit := Inv32CeilAdd.good (n+14) t c final q b qb bb fits ch rfl rfl
  have body : Stmt.eval (n+16) t c outer (.block ss) = pure (.returned outer [.word (rounded x y d up)]) := by
    apply blockReturned _ _ _ _ final
    rw [Inv32CeilBody.shape]
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ z1).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ f1).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ z2).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ f2).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ casted).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ z3).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ f).trans (stop _ _ _ _ _ _ [] _ exit)))))))
  have a := cleanParamExec (n+15) t c outer "x" x hx rfl (by dsimp [outer,src,roundingFrame]; write_param)
  have b' := cleanParamExec (n+15) t c outer "y" y hy rfl (by dsimp [outer,src,roundingFrame]; write_param)
  have e := cleanParamExec (n+15) t c outer "denominator" d hd rfl (by dsimp [outer,src,roundingFrame]; write_param)
  have sk : Stmt.eval (n+16) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  apply blockReturned _ _ _ _ outer
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ a).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ b').trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ e).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ body)))))

include roundedLinked
theorem roundedCall (n : Nat) (c : Context) (r : Runtime) (a b den mode : String)
    (targets : List String) (x y d : Nat) (up : Bool) (hx : x<R) (hy : y<R) (hd : d<R)
    (hp : 0<d) (fits : rounded x y d up<R)
    (X : r.lookupLocal? a = some (.word x)) (Y : r.lookupLocal? b = some (.word y))
    (D : r.lookupLocal? den = some (.word d)) (U : r.lookupLocal? mode = some (.word (boolWord up))) :
    Stmt.eval (n+18) table c r
      (.internalCall targets Inv32Bodies.Ceil.key [.var a,.var b,.var den,.var mode]) =
      internalCallAssign r targets [.word (rounded x y d up)] := by
  obtain ⟨fn,found,ps,rs,body⟩ := roundedLinked
  let empty := {r with locals := []}
  let src := empty.withFrame (roundingFrame x y d up)
  have enter : internalCallEnter? fn [.word x,.word y,.word d,.word (boolWord up)] r =
      some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,roundingFrame,src,empty,Runtime.withFrame]
  have ev := execute productLinked floorLinked roundsLinked uintLinked n {c with checked := true} empty x y d up hx hy hd hp rfl fits
  rw [← body] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _
    (Inv32CeilCall.args4 _ _ _ _ _ _ _ _ _ _ X Y D U) found enter ev]
  have ret : coerceReturnBindingsRef fn.returns src [.word (rounded x y d up)] =
      .ok [.word (rounded x y d up)] := by
    rw [rs]
    simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  dsimp only [src] at ret
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret]
  rfl
#print axioms roundedCall
end Inv48.QuoteExecMath
