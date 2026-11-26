import Inv05MintBody
open SolidCore.Solidity.Source Inv32Division
namespace Inv05
def result (cash units net : Nat) := if cash=0 then some 0 else quote cash units net
def allUnits (cash units net : Nat) := if units=0 then some (cash*10^9) else result cash units net
def Binds (r : Runtime) (targets : List String) (o : Option Nat) (p : SolI Result) : Prop :=
  match o with
  | some a => p = internalCallAssign r targets [.word a]
  | none => ∃ nr e, p = pure (.reverted nr e)

theorem call (f : Nat) (c : Context) (r : Runtime) (x y z : String) (targets : List String)
    (cash units net : Nat) (hc : cash<R) (hu : units<R) (hn : net<R) (funded : units=0 ∨ 0<net) (fits : cash*10^9<R)
    (X : r.lookupLocal? x=some (.word cash)) (Y : r.lookupLocal? y=some (.word units)) (Z : r.lookupLocal? z=some (.word net)) :
    Binds r targets (allUnits cash units net) (Stmt.eval (f+28) Inv03.model.core.table c r (.internalCall targets key [.var x,.var y,.var z])) := by
  obtain ⟨fn,found,ps,rs,bd⟩ := mintBody
  let empty := {r with locals := []}
  let src := empty.withFrame (frame cash units net 0)
  have enter : internalCallEnter? fn [.word cash,.word units,.word net] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have args := Inv32FloorCall.args c r _ _ _ _ _ _ X Y Z
  by_cases zero : cash=0
  · subst cash
    have ev := zeroBody f {c with checked:=true} empty units net hu hn
    rw [←bd] at ev
    have q : allUnits 0 units net = some 0 := by simp [allUnits,result]
    rw [q]
    change Stmt.eval _ _ _ _ _ = _
    rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
    cases targets <;> simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,
      Inv32Library.decl,frame,src,empty,Runtime.withFrame,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,Bind.bind,Except.bind]
  · by_cases emptyUnits : units=0
    · subst units
      have ev := initialBody f {c with checked:=true} empty cash net hc (Nat.pos_of_ne_zero zero) hn fits
      rw [←bd] at ev
      unfold allUnits; rw [if_pos rfl]
      change Stmt.eval _ _ _ _ _ = _
      rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
      cases targets <;> simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,
        Inv32Library.decl,frame,empty,Runtime.withFrame,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
        Ty.coerceValue?,Bind.bind,Except.bind]
    · have up := Nat.pos_of_ne_zero emptyUnits
      have np := funded.resolve_left emptyUnits
      have ev := positiveBody f {c with checked:=true} empty cash units net hc hu hn (Nat.pos_of_ne_zero zero) up np fits
      rw [←bd] at ev
      unfold allUnits; rw [if_neg emptyUnits]; unfold result; rw [if_neg zero]
      cases Q : quote cash units net with
      | none =>
        rw [Q] at ev
        obtain ⟨nr,e,execution⟩ := ev
        exact ⟨nr,e,Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter execution⟩
      | some a =>
        rw [Q] at ev
        change Stmt.eval _ _ _ _ _ = _
        rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter (show Stmt.eval _ _ _ src fn.body =
          pure (.normal (empty.withFrame (frame cash units net a))) from ev)]
        simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,Inv32Library.decl,frame,empty,
          Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,
          Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
end Inv05
