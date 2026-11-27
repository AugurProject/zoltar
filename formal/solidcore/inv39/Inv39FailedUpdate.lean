import Inv39UpdateCall
import Inv39Shortage
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.ERC20
private theorem pureBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem failedUpdateCall (n : Nat) (c : Context) (r : Runtime) (src dst val : Nat) (x y z : String)
    (X : r.lookupLocal? x=some (.word src)) (Y : r.lookupLocal? y=some (.word dst)) (Z : r.lookupLocal? z=some (.word val))
    (sFit : src<R) (nz : src≠0) (low : r.state.loadSlot (balanceSlot src)<val) (fit : val<R)
    (fields : c.storageFields=model.core.context.storageFields) :
    ∃ next, Stmt.eval (n+8) model.core.table c r (.internalCall [] updateKey [.var x,.var y,.var z]) = pure (.reverted next lowFunds) := by
  obtain ⟨fn,found,ps,rs,bodyEq⟩ := linked
  let checked := {c with checked:=true}
  let base := {r with locals:=[]}
  have ev := updateRejected n model.core.table checked base src dst val sFit nz low fit fields
  rw [←bodyEq] at ev
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
  refine ⟨entry base src dst val,?_⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  rfl
end Inv39.ERC20
