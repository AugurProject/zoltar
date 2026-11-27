import Inv45MulExecution
import Inv45Absolute
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.MulDiv
theorem call (fuel : Nat) (c : Context) (r : Runtime) (x y d : Nat) (xn yn dn : String) (targets : List String)
    (X : x<R) (Y : y<R) (D : d<R) (pos : 0<d) (fit : x*y/d<R)
    (xHere : r.lookupLocal? xn=some (.word x)) (yHere : r.lookupLocal? yn=some (.word y))
    (dHere : r.lookupLocal? dn=some (.word d)) :
    Stmt.eval (fuel+8) model.core.table c r (.internalCall targets key [.var xn,.var yn,.var dn])=
      internalCallAssign r targets [.word (x*y/d)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := signature
  let empty := {r with locals:=[]}
  have enter : internalCallEnter? fn [.word x,.word y,.word d] r=some (arguments empty x y d 0,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
      Ty.coerceValue?,Ty.defaultValue,arguments,empty,Runtime.withFrame]
  have ev := bodyExecution fuel model.core.table {c with checked:=true} empty x y d X Y D pos fit
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32FloorCall.args _ _ _ _ _ _ _ _ xHere yHere dHere) found enter ev]
  unfold bodyResult
  split
  · simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,arguments,empty,Runtime.withFrame]
  · simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,Inv32Library.decl,arguments,empty,
      Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
end Inv45.MulDiv
namespace Inv45.Shapes
theorem absoluteCall (fuel : Nat) (c : Context) (r : Runtime) (v : Int) (name : String) (targets : List String)
    (V : Signed.inRange v) (localV : r.lookupLocal? name=some (.int (Signed.word v))) :
    Stmt.eval (fuel+7) model.core.table c r (.internalCall targets absoluteKey [.var name]) =
      internalCallAssign r targets [.word v.natAbs] := by
  let empty := {r with locals:=[]}
  have find : model.core.table.lookup? absoluteKey=some absoluteFn := (Option.some_get existsFn).symm
  have refArg : Expr.evalRefArg c r (.var name)=pure (.int (Signed.word v),r) := by
    simp [Expr.evalRefArg, Runtime.lookupMemoryRef?,Runtime.lookupStorageBase?,localV]
    exact Inv45.readSignedLocal _ _ _ _ localV _ (Nat.le_succ _)
  have args : Expr.evalRefArgList c r [.var name]=pure ([.int (Signed.word v)],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var name]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,refArg,Inv08.Authority.bindPure]
  obtain ⟨ps,rs⟩ := absoluteSignature
  have enter : internalCallEnter? absoluteFn [.int (Signed.word v)] r=some (empty.withFrame (absoluteFrame v),r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
      Ty.coerceValue?,Ty.defaultValue,absoluteFrame,empty,Runtime.withFrame]
  have ev := absoluteExecution fuel model.core.table {c with checked:=true} empty v V
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args find enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,absoluteFrame,empty,Runtime.withFrame]
end Inv45.Shapes
