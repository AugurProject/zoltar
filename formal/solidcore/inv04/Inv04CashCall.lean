import Inv04CashRun
open SolidCore.Solidity.Source Inv32Division
namespace Inv04.Cash
theorem call (fuel : Nat) (c : Context) (r : Runtime) (a b den mode : String)
    (targets : List String) (u n d rem : Nat) (hu : u<R) (hn : n<R) (hd : d<R) (hr : rem<R)
    (positive : 0<d) (fits : Inv03.ceilQuot (u*n) d+rem<R)
    (X : r.lookupLocal? a = some (.word u)) (N : r.lookupLocal? b = some (.word n))
    (T : r.lookupLocal? den = some (.word d)) (M : r.lookupLocal? mode = some (.word rem)) :
    Stmt.eval (fuel+24) Inv03.model.core.table c r (.internalCall targets Shapes.requiredKey
      [.var a,.var b,.var den,.var mode]) = internalCallAssign r targets [.word (Inv03.ceilQuot (Inv03.ceilQuot (u*n) d+rem) (10^9))] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := Shapes.requiredLinked
  let empty := {r with locals := []}
  let src := empty.withFrame (frame u n d rem)
  have enter : internalCallEnter? fn [.word u,.word n,.word d,.word rem] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have ev := run fuel {c with checked := true} empty u n d rem hu hn hd hr positive fits rfl
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _
    (Inv32CeilCall.args4 _ _ _ _ _ _ _ _ _ _ X N T M) found enter ev]
  have ret : coerceReturnBindingsRef fn.returns src [.word (Inv03.ceilQuot (Inv03.ceilQuot (u*n) d+rem) (10^9))] =
      .ok [.word (Inv03.ceilQuot (Inv03.ceilQuot (u*n) d+rem) (10^9))] := by
    rw [rs]
    simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  dsimp only [src] at ret
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret]
  rfl

end Inv04.Cash
