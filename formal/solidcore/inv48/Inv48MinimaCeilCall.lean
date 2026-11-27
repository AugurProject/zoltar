import Inv48MinimaCeilRun
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32Hoist
namespace Inv48.MinimaCeil
theorem call (table : FunctionTable) (ceilLinked : Inv32Library.LinkAt table Inv04.Shapes.ceilKey [.word "a",.word "b"] [.word "_ret0"] Inv04.Shapes.ceilShape.value) (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body) (n : Nat) (c : Context) (r : Runtime) (x : Nat) (small : x<R) (s1 s2 ret : String)
    (X : r.lookupLocal? s1 = some (.word x)) (S : r.lookupLocal? s2 = some (.word 100)) :
    Stmt.eval (n+14) table c r (.internalCall [ret] Inv04.Shapes.ceilKey [.var s1,.var s2]) =
      internalCallAssign r [ret] [.word (Inv03.ceilQuot x 100)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := ceilLinked
  let empty := {r with locals := []}
  let src := empty.withFrame (frame x)
  have enter : internalCallEnter? fn [.word x,.word 100] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have ev := run table uintLinked n {c with checked := true} empty x small
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args _ _ _ _ _ _ X S) found enter ev]
  have out : coerceReturnBindingsRef fn.returns src [.word (Inv03.ceilQuot x 100)] =
      .ok [.word (Inv03.ceilQuot x 100)] := by
    rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  dsimp only [src] at out
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,out]
  rfl
end Inv48.MinimaCeil
