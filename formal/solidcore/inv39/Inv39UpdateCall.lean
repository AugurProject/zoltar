import Inv39EmitSuccess
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.ERC20
private theorem pureBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem updateCall (n : Nat) (c : Context) (r : Runtime) (src dst val : Nat) (x y z : String)
    (X : r.lookupLocal? x=some (.word src)) (Y : r.lookupLocal? y=some (.word dst)) (Z : r.lookupLocal? z=some (.word val))
    (S : src<2^160) (D : dst<2^160) (V : val<R)
    (debit : fromBounds r.state src val) (credit : toBounds (afterFrom r.state src val) dst val)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+8) model.core.table c r (.internalCall [] updateKey [.var x,.var y,.var z]) = pure (.normal next) ∧
      next.locals=r.locals ∧ next.state.storage=(afterTo (afterFrom r.state src val) dst val).storage := by
  obtain ⟨fn,found,ps,rs,bodyEq⟩ := linked
  let checked := {c with checked:=true}
  let base := {r with locals:=[]}
  let inner := (entry base src dst val).pushScope.pushScope
  let pay := written inner src dst val
  have srcWord : src<R := lt_trans S (by decide)
  have dstWord : dst<R := lt_trans D (by decide)
  have sAddr : abiAddressFits src := by simpa [abiAddressFits,show Shared.norm src=src from Nat.mod_eq_of_lt srcWord] using S
  have dAddr : abiAddressFits dst := by simpa [abiAddressFits,show Shared.norm dst=dst from Nat.mod_eq_of_lt dstWord] using D
  obtain ⟨logged,lg⟩ := emitSuccess checked pay src dst val sAddr dAddr events
  have eq := logPreservesStorage _ _ _ _ _ lg
  have ev := updateExecution n model.core.table checked base src dst val srcWord dstWord V debit credit fields events
  have rr : updateResult checked base src dst val = .normal logged.popScope.popScope := by
    change ((eventResult checked pay src dst val).mapRuntime _).mapRuntime _ = _
    unfold eventResult
    rw [lg]; rfl
  rw [rr,←bodyEq] at ev
  let vs := [Value.word src,.word dst,.word val]
  have args : Expr.evalRefArgList c r [.var x,.var y,.var z] = pure (vs,r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var x,.var y,.var z] = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,
      Inv32ProductCall.wordArg _ _ _ _ X,Inv32ProductCall.wordArg _ _ _ _ Y,
      Inv32ProductCall.wordArg _ _ _ _ Z,pureBind,vs]
  have enter : internalCallEnter? fn vs r = some (entry base src dst val,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [vs,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,
      entry,Runtime.withFrame,base]
  let post := {logged.popScope.popScope with locals:=r.locals}
  refine ⟨post,?_,rfl,eq.1⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,internalCallAssign,Runtime.assignNamedValuesRef?,post]
end Inv39.ERC20
