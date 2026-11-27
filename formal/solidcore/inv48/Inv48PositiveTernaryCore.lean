import Inv48PositiveTernaryFormula
import Inv48PositiveOneArg
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions
open Inv32NewtonBody Inv32NewtonSeed Inv48.PositiveTernary
namespace Inv48.PositiveTernaryCore
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem execute (table : FunctionTable) (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body) (n : Nat) (c : Context) (r : Runtime) (flag : Bool) (a b : W) :
    let src := r.withFrame (frame flag a.toNat b.toNat)
    Stmt.eval (n+13) table c src Inv32Bodies.Ternary.body =
      pure (.returned src [.word (if flag then a.toNat else b.toNat)]) := by
  let t := table
  let src := r.withFrame (frame flag a.toNat b.toNat)
  let outside := src.pushScope
  let root := outside.pushScope.pushScope
  let ctx := {c with checked := false}
  let after := Inv48.PositiveOneArg.store root Inv32PanicChoice.outName (boolWord flag)
  let vs := [Value.word (if flag then a.toNat else b.toNat)]
  have Z := Inv32FloorStart.zero (n+8) t ctx root Inv32PanicChoice.outName
  have S : Stmt.eval (n+9) t ctx (Inv48.PositiveOneArg.store root Inv32PanicChoice.outName 0)
      Inv32PanicChoice.stage = pure (.normal after) := by
    apply Inv48.PositiveOneArg.execute (n+6) t ctx root _ _ _ .bool .uint256 (.var "condition")
      (boolWord flag) (boolWord flag) (by decide) (by decide) (by decide)
    · exact Inv48.PositiveHoist.boolCoerce _
    · rw [Ty.defaultValue]
    · exact Inv32Guards.readWord _ _ _ _ _ rfl
    · exact Inv32FlagCalls.toUintAt t uintLinked n ctx _ _ _ flag rfl
  have L := leaf (n+8) t ctx after flag a b rfl (by
    intro k v h
    unfold env at h
    split at h <;> simp_all [after,root,outside,src,frame,Inv48.PositiveOneArg.store,Inv32PanicChoice.outName,
      Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?])
  have list : Stmt.evalList (n+9) t ctx root
      [.varDecl .uint256 Inv32PanicChoice.outName none,Inv32PanicChoice.stage,
       .returnValues [Inv32PanicChoice.answer.core]] = pure (.returned after vs) :=
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ L))
  have inner := Inv32FloorFastPath.blockReturned _ t ctx outside.pushScope _ _ _ list
  have un : Stmt.eval (n+11) t c outside.pushScope
      (.unchecked (.block [.varDecl .uint256 Inv32PanicChoice.outName none,Inv32PanicChoice.stage,
        .returnValues [Inv32PanicChoice.answer.core]])) = pure (.returned after.popScope vs) := by
    rw [Stmt.eval]; exact inner
  have block' := Inv32FloorFastPath.blockReturned _ t c outside _ _ _ (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ un)
  have sk : Stmt.eval (n+12) t c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
  have A := Inv32FloorFastPath.cleanParamExec (n+11) t c outside "a" a.toNat a.isLt rfl
    (by dsimp [outside,src,frame]; store_flag)
  have B := Inv32FloorFastPath.cleanParamExec (n+11) t c outside "b" b.toNat b.isLt rfl
    (by dsimp [outside,src,frame]; store_flag)
  rw [Inv32TernaryCall.atBody]; unfold Inv32TernaryCall.body
  apply Inv32FloorFastPath.blockReturned _ _ _ src outside _ vs
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ block'))))

theorem call (table : FunctionTable) (linked : Inv32Library.LinkAt table Inv32Bodies.Ternary.key [.flag "condition",.word "a",.word "b"] [.word "_ret0"] Inv32Bodies.Ternary.body) (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body) (n : Nat) (c : Context) (r : Runtime) (x y z : String) (targets : List String)
    (flag : Bool) (a b : W)
    (X : r.lookupLocal? x = some (.word (boolWord flag)))
    (Y : r.lookupLocal? y = some (.word a.toNat))
    (Z : r.lookupLocal? z = some (.word b.toNat)) :
    Stmt.eval (n+14) table c r
      (.internalCall targets Inv32Bodies.Ternary.key [.var x,.var y,.var z]) =
      internalCallAssign r targets [.word (if flag then a.toNat else b.toNat)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := linked
  let empty := {r with locals := []}
  let source := empty.withFrame (frame flag a.toNat b.toNat)
  have enter : internalCallEnter? fn [.word (boolWord flag),.word a.toNat,.word b.toNat] r =
      some (source,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    cases flag <;> simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,source,empty,Runtime.withFrame,frame,boolWord] <;> rfl
  have ev := execute table uintLinked n {c with checked := true} empty flag a b
  change Stmt.eval _ _ _ source _ = _ at ev
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _
    (Inv32FloorCall.args _ _ _ _ _ _ _ _ X Y Z) found enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,source,empty,
    Runtime.withFrame,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]

#print axioms Inv48.PositiveTernary.computes
#print axioms execute
#print axioms call

end Inv48.PositiveTernaryCore
