import Inv04CeilRun
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32Hoist
namespace Inv04.Ceil
theorem call (n : Nat) (c : Context) (r : Runtime) (x : Nat) (small : x<R) (s1 s2 ret : String)
    (X : r.lookupLocal? s1 = some (.word x)) (S : r.lookupLocal? s2 = some (.word (10^9))) :
    Stmt.eval (n+14) Inv03.model.core.table c r (.internalCall [ret] Shapes.ceilKey [.var s1,.var s2]) =
      internalCallAssign r [ret] [.word (Inv03.ceilQuot x (10^9))] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := Shapes.ceilLinked
  let empty := {r with locals := []}
  let src := empty.withFrame (frame x)
  have enter : internalCallEnter? fn [.word x,.word (10^9)] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have ev := run n {c with checked := true} empty x small
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args _ _ _ _ _ _ X S) found enter ev]
  have out : coerceReturnBindingsRef fn.returns src [.word (Inv03.ceilQuot x (10^9))] =
      .ok [.word (Inv03.ceilQuot x (10^9))] := by
    rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  dsimp only [src] at out
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,out]
  rfl
abbrev slot := "_ret___library_Math_ceilDiv_0"
private def temps (r : Runtime) (dst : String) (v x y result : Nat) :=
  (st2 r dst v x y).declareLocal slot (.word result)
def code := Inv03.Bodies.hoist Shapes.ceilKey slot
  [(a0,Inv03.Bodies.wvar Shapes.sum),(a1,Inv03.Bodies.wvar Shapes.scale)]
theorem hoist (n : Nat) (c : Context) (r : Runtime) (x : Nat) (small : x<R)
    (X : (start r Inv03.Bodies.tmp 0).lookupLocal? Shapes.sum = some (.word x))
    (S : (st1 r Inv03.Bodies.tmp 0 x).lookupLocal? Shapes.scale = some (.word (10^9))) :
    Stmt.eval (n+16) Inv03.model.core.table c (Inv32OneArg.store r Inv03.Bodies.tmp 0) code.value =
      pure (.normal (Inv32OneArg.store r Inv03.Bodies.tmp (Inv03.ceilQuot x (10^9)))) := by
  let t := Inv03.model.core.table
  let st := fun o v => temps r Inv03.Bodies.tmp o x (10^9) v
  let v := Inv03.ceilQuot x (10^9)
  have called := call n c (st 0 0) x small a0 a1 slot rfl rfl
  have put : (st 0 0).assignLocal? slot (.word v) = some (st 0 v) := by
    cases H : r.locals <;> dsimp [st,temps,slot] <;> write_temps
  have picked := takeReturn _ _ _ _ _ _ _ _ _ called put
  have cp : Stmt.evalList (n+15) t c (st 0 v) [.assign (.var Inv03.Bodies.tmp) (.var slot)] =
      pure (.normal (st v v)) := by
    apply lastCopy _ _ _ _ _ _ _ 0 v
    all_goals cases H : r.locals <;> dsimp [st,temps,slot,Inv03.Bodies.tmp,Inv32CeilFlags.h0] <;> write_temps
  apply block _ _ _ _ (st v v)
  refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+14) t c _ a0 Shapes.sum x small X)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+14) t c _ a1 Shapes.scale (10^9) (by decide) S)).trans ?_
  exact (seqStep _ _ _ _ _ _ _ (zero (n+14) t c _ slot)).trans ((seqStep _ _ _ _ _ _ _ picked).trans cp)
end Inv04.Ceil
