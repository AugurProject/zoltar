import Inv48QuoteWideBoundsFloor
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32CeilFlags Inv32FloorFastPath
open Inv32Hoist Inv32FloorStart Inv32OneArg Inv32FloorHoist
namespace Inv48.QuoteWideBounds
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem floorHoistOverflow (table : FunctionTable) (links : Inv32Rejection.Links table) (n : Nat) (c : Context) (r : Runtime) (dst : String) (ex ey ed : Expr)
    (x y d : Nat) (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d) (large : R≤x*y/d)
    (args : Inputs c r dst ex ey ed x y d) :
    ∃ next err, Stmt.eval (n+25) table c (store r dst 0) (code dst ex ey ed) =
      pure (.reverted next err) := by
  obtain ⟨next,err,ev⟩ := Inv32FloorOverflow.callAt table links n c (state r dst 0 x y d 0) a0 a1 a2 [ret] x y d hx hy hd hp large rfl rfl rfl
  have cap := Inv32Revert.capture _ _ _ _ _ _ [ret] _ ev
  exact ⟨next.popScope,err,Inv32Revert.blockRevert _ _ _ _ _ _ _ ((bindArgs (n+23) _ _ _ _ _ _ _ _ _ _ _ args).trans
    (Inv32Revert.stop _ _ _ _ _ _ [.assign (.var dst) (.var ret)] _ cap))⟩
private def roundingFrame (x y d : Nat) (up : Bool) : Frame :=
  [("x",.word x),("y",.word y),("denominator",.word d),("rounding",.word (boolWord up)),("_ret0",.word 0)]

theorem roundedOverflow (n : Nat) (c : Context) (r : Runtime) (x y d : Nat) (up : Bool)
    (hx : x<R) (hy : y<R) (hd : d<R) (hp : 0<d) (ch : c.checked=true)
    (over : R≤Inv48.QuoteExecMath.rounded x y d up) :
    ∃ next err, Stmt.eval (n+32) Inv48.Source.model.core.table c
      (r.withFrame (roundingFrame x y d up)) Inv32Bodies.Ceil.body = pure (.reverted next err) := by
  let t := Inv48.Source.model.core.table
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
  have bb : b<R := by dsimp only [b]; cases bit <;> decide
  have z1 := Inv32Hoist.zeroBool (n+29) t c root h0
  have f1 := firstStepAt t Inv48.FeedMath.roundsLinked (n+24) c r x y d up
  have z2 := Inv32FloorStart.zero (n+29) t c stage1 h1
  have f2 := secondStepAt t Inv48.FeedMath.uintLinked (n+21) c r x y d up hx hy hd hp
  have casted := Inv32Hoist.declEval (n+29) t c stage2 h3 .uint256 Inv32CeilBody.flagExpr.core b
    (evalFormula Inv32CeilBody.flagExpr c stage2 b (by decide)
      (by cases h : bit <;> change _ = some (boolWord bit) <;>
          simp only [h] <;> dsimp [stage2,stage1,b] <;> rw [h] <;> cases c.checked <;> rfl))
    (by rw [Ty.coerceValue?])
  have z3 := Inv32FloorStart.zero (n+29) t c stage3 h2
  have inputs : Inv32FloorHoist.Inputs c stage3 h2 (Inv32CeilBody.w "x") (Inv32CeilBody.w "y")
        (Inv32CeilBody.w "denominator") x y d :=
    ⟨Inv32Guards.clean _ _ _ _ _ hx (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hy (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hd (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have tail : ∃ next err, Stmt.evalList (n+30) t c (Inv32OneArg.store stage3 h2 0)
      [Inv32CeilBody.floor,Inv32CeilAdd.ret] = pure (.reverted next err) := by
    by_cases qb : q<R
    · have f := Inv32FloorHoist.successAt t Inv48.FeedMath.productLinked Inv48.FeedMath.floorLinked (n+15) c stage3 h2 _ _ _ _ _ _
        hx hy hd hp qb inputs (by decide) (by decide) (by decide) (by decide)
      have exit := Inv32CeilAdd.bad (n+29) t c final q b qb bb over ch rfl rfl
      exact ⟨final,.overflow,(Inv32FloorStart.seqStep _ _ _ _ _ _ _ f).trans
        (Inv32Revert.stop _ _ _ _ _ _ [] _ exit)⟩
    · obtain ⟨next,err,f⟩ := floorHoistOverflow t rejectionLinks (n+5) c stage3 h2 _ _ _ x y d
        hx hy hd hp (Nat.le_of_not_gt qb) inputs
      exact ⟨next,err,Inv32Revert.stop _ _ _ _ _ _ _ _ f⟩
  obtain ⟨next,err,tail⟩ := tail
  have inside : Stmt.evalList (n+30) t c outer.pushScope ss = pure (.reverted next err) := by
    rw [Inv32CeilBody.shape]
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ z1).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ f1).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ z2).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ f2).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ casted).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ z3).trans tail)))))
  have body := Inv32Revert.blockRevert _ t c outer next ss err inside
  have a := cleanParamExec (n+30) t c outer "x" x hx rfl (by dsimp [outer,src,roundingFrame]; write_param)
  have b' := cleanParamExec (n+30) t c outer "y" y hy rfl (by dsimp [outer,src,roundingFrame]; write_param)
  have e := cleanParamExec (n+30) t c outer "denominator" d hd rfl (by dsimp [outer,src,roundingFrame]; write_param)
  have sk : Stmt.eval (n+31) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  refine ⟨next.popScope.popScope,err,?_⟩
  apply Inv32Revert.blockRevert
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ a).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ b').trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ e).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ body)))))

/-- The call enters checked Math even if its caller is unchecked. -/
theorem roundedCallOverflow (n : Nat) (c : Context) (r : Runtime) (a b den mode : String)
    (targets : List String) (x y d : Nat) (up : Bool) (hx : x<R) (hy : y<R) (hd : d<R)
    (hp : 0<d) (over : R≤Inv48.QuoteExecMath.rounded x y d up)
    (X : r.lookupLocal? a = some (.word x)) (Y : r.lookupLocal? b = some (.word y))
    (D : r.lookupLocal? den = some (.word d)) (U : r.lookupLocal? mode = some (.word (boolWord up))) :
    ∃ next err, Stmt.eval (n+33) Inv48.Source.model.core.table c r
      (.internalCall targets Inv32Bodies.Ceil.key [.var a,.var b,.var den,.var mode]) =
      pure (.reverted next err) := by
  obtain ⟨fn,found,ps,rs,body⟩ := Inv48.FeedMath.roundedLinked
  let empty := {r with locals := []}
  let src := empty.withFrame (roundingFrame x y d up)
  have enter : internalCallEnter? fn [.word x,.word y,.word d,.word (boolWord up)] r =
      some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,roundingFrame,src,empty,Runtime.withFrame]
  obtain ⟨next,err,ev⟩ := roundedOverflow n {c with checked := true} empty x y d up hx hy hd hp rfl over
  rw [← body] at ev
  exact ⟨next,err,Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _
    (Inv32CeilCall.args4 _ _ _ _ _ _ _ _ _ _ X Y D U) found enter ev⟩

theorem roundedFits (n : Nat) (c : Context) (r : Runtime) (a b den mode : String)
    (targets : List String) (x y d : Nat) (up : Bool) (hx : x<R) (hy : y<R) (hd : d<R)
    (hp : 0<d)
    (X : r.lookupLocal? a = some (.word x)) (Y : r.lookupLocal? b = some (.word y))
    (D : r.lookupLocal? den = some (.word d)) (U : r.lookupLocal? mode = some (.word (boolWord up)))
    (trace : EvmCompiler.Simulation.Interaction.Transcript) (result : Result)
    (run : EvmCompiler.Simulation.Interaction.Executes
      (Stmt.eval (n+33) Inv48.Source.model.core.table c r
        (.internalCall targets Inv32Bodies.Ceil.key [.var a,.var b,.var den,.var mode])) trace (.ok result))
    (normal : ∀ mid err, result ≠ .reverted mid err) :
    Inv48.QuoteExecMath.rounded x y d up<R := by
  by_contra bad
  obtain ⟨next,err,ev⟩ := roundedCallOverflow n c r a b den mode targets x y d up hx hy hd hp
    (Nat.le_of_not_gt bad) X Y D U
  rw [ev] at run
  cases run
  exact normal next err rfl
#print axioms roundedOverflow
#print axioms roundedCallOverflow
#print axioms roundedFits
end Inv48.QuoteWideBounds
