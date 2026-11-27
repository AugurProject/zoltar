import Inv39SpendCall
import Inv39DeniedSpendBody
import Inv39AllowanceBindings
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
private theorem pureBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem deniedSpendCall (n : Nat) (c : Context) (r : Runtime) (o s old v : Nat) (x y z : String)
    (O : r.lookupLocal? x=some (.word o)) (S : r.lookupLocal? y=some (.word s)) (V : r.lookupLocal? z=some (.word v))
    (atSlot : r.state.loadSlot (slot o s)=old) (ow : o<R) (bounded : old<R-1) (vf : v<R) (err : RevertData) (bad : ChargeDenied o s old v err)
    (fields : c.storageFields=model.core.context.storageFields) :
    ∃ q, Stmt.eval (n+15) model.core.table c r (.internalCall [] spendKey [.var x,.var y,.var z])=pure (.reverted q err) := by
  obtain ⟨fn,found,ps,rs,bd⟩ := spendLink
  let values := [Source.Value.word o,.word s,.word v]
  let bare := {r with locals:=[]}
  let entry := bare.withFrame (args3 o s v)
  have args : Expr.evalRefArgList c r [.var x,.var y,.var z]=pure (values,r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var x,.var y,.var z]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ O,
      Inv32ProductCall.wordArg _ _ _ _ S,Inv32ProductCall.wordArg _ _ _ _ V,pureBind,values]
  have enter : internalCallEnter? fn values r=some (entry,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [params3,params2,values,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,
      args3,Runtime.withFrame,entry,bare]
  obtain ⟨q,exec⟩ := deniedSpendBody n {c with checked:=true} bare o s old v ow atSlot bounded vf err bad fields
  rw [←bd] at exec
  refine ⟨q,?_⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter exec]; rfl
end Inv39.Allowance
