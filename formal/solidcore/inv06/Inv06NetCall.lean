import Inv06Net
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32Hoist
namespace Inv06.Net
theorem call (n : Nat) (c : Context) (r : Runtime) (x rem : Nat) (cap : x<2^128) (le : rem≤x*10^9) (s1 s2 ret : String)
    (X : r.lookupLocal? s1 = some (.word x)) (S : r.lookupLocal? s2 = some (.word rem)) :
    Stmt.eval (n+5) Inv03.model.core.table c r (.internalCall [ret] Shapes.netKey [.var s1,.var s2]) =
      internalCallAssign r [ret] [.word (x*10^9-rem)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := Shapes.netLinked
  let empty := {r with locals := []}
  let src := empty.withFrame (frame x rem)
  have enter : internalCallEnter? fn [.word x,.word rem] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have ev := run n {c with checked := true} empty x rem cap le
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args _ _ _ _ _ _ X S) found enter ev]
  have out : coerceReturnBindingsRef fn.returns src [.word (x*10^9-rem)] =
      .ok [.word (x*10^9-rem)] := by
    rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  dsimp only [src] at out
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,out]
  rfl
abbrev slot := Shapes.netRet
private def temps (r : Runtime) (dst : String) (v x y result : Nat) :=
  (st2 r dst v x y).declareLocal slot (.word result)
def code := Inv03.Bodies.hoist Shapes.netKey slot
  [(a0,Inv03.Bodies.wvar "cash"),(a1,Inv03.Bodies.wvar "remainder")]
theorem hoist (n : Nat) (c : Context) (r : Runtime) (x rem : Nat) (cap : x<2^128) (le : rem≤x*10^9)
    (X : (start r Inv03.Bodies.tmp 0).lookupLocal? "cash" = some (.word x))
    (S : (st1 r Inv03.Bodies.tmp 0 x).lookupLocal? "remainder" = some (.word rem)) :
    Stmt.eval (n+7) Inv03.model.core.table c (Inv32OneArg.store r Inv03.Bodies.tmp 0) code.value =
      pure (.normal (Inv32OneArg.store r Inv03.Bodies.tmp (x*10^9-rem))) := by
  let t := Inv03.model.core.table
  let st := fun o v => temps r Inv03.Bodies.tmp o x rem v
  let v := x*10^9-rem
  have called := call n c (st 0 0) x rem cap le a0 a1 slot rfl rfl
  have put : (st 0 0).assignLocal? slot (.word v) = some (st 0 v) := by
    cases H : r.locals <;> dsimp [st,temps,slot,Shapes.netRet] <;> write_temps
  have picked := takeReturn _ _ _ _ _ _ _ _ _ called put
  have cp : Stmt.evalList (n+6) t c (st 0 v) [.assign (.var Inv03.Bodies.tmp) (.var slot)] =
      pure (.normal (st v v)) := by
    apply lastCopy _ _ _ _ _ _ _ 0 v
    all_goals cases H : r.locals <;> dsimp [st,temps,slot,Shapes.netRet,Inv03.Bodies.tmp,Inv32CeilFlags.h0] <;> write_temps
  apply block _ _ _ _ (st v v)
  refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+5) t c _ a0 "cash" x (lt_trans cap (by decide)) X)).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp (n+5) t c _ a1 "remainder" rem (lt_of_le_of_lt le (lt_trans (Nat.mul_lt_mul_of_pos_right cap (by decide : 0<10^9)) (by decide))) S)).trans ?_
  exact (seqStep _ _ _ _ _ _ _ (zero (n+5) t c _ slot)).trans ((seqStep _ _ _ _ _ _ _ picked).trans cp)
end Inv06.Net
