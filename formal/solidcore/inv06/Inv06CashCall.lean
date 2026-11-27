import Inv06CashBody
open SolidCore.Solidity.Source Inv32Division
namespace Inv06.Cash
theorem call (fuel : Nat) (c : Context) (r : Runtime) (cashArg unitsArg carryArg burnedArg : String)
    (targets : List String) (cash units carry burned : Nat) (cap : cash<2^128) (book : units<2^128) (balance : burned≤units) (le : carry≤cash*10^9)
    (X : r.lookupLocal? cashArg = some (.word cash)) (N : r.lookupLocal? unitsArg = some (.word units))
    (T : r.lookupLocal? carryArg = some (.word carry)) (M : r.lookupLocal? burnedArg = some (.word burned)) :
    Stmt.eval (fuel+33) Inv03.model.core.table c r (.internalCall targets Shapes.cashKey
      [.var cashArg,.var unitsArg,.var carryArg,.var burnedArg]) = internalCallAssign r targets [.word (payment cash units carry burned)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := Shapes.cashLinked
  let empty := {r with locals := []}
  let src := empty.withFrame (frame cash units carry burned)
  have enter : internalCallEnter? fn [.word cash,.word units,.word carry,.word burned] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have ev := run fuel {c with checked := true} empty cash units carry burned cap book balance le
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _
    (Inv32CeilCall.args4 _ _ _ _ _ _ _ _ _ _ X N T M) found enter ev]
  have ret : coerceReturnBindingsRef fn.returns src [.word (payment cash units carry burned)] =
      .ok [.word (payment cash units carry burned)] := by
    rw [rs]
    simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  dsimp only [src] at ret
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret]
  rfl

end Inv06.Cash
