import Inv39SpendBody
import Inv39AllowanceBindings
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
private theorem pureBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
def params3 : List BindingDecl := params2++[⟨"value",.uint256,false⟩]
theorem spendLink : ∃ f, model.core.table.lookup? spendKey=some f ∧ f.params=params3 ∧ f.returns=[] ∧ f.body=spendShape.value := by
  have h := spendChecked; simp only [Bool.and_eq_true] at h
  obtain ⟨f,eq,m,b⟩ := lookupCertified spendKey spendShape spendMeta h.1
  refine ⟨f,eq,?_,?_,b⟩ <;> unfold spendMeta at m <;> split at m <;> simp_all [params2,params3]
theorem spendCall (n : Nat) (c : Context) (r : Runtime) (o s old v : Nat) (x y z : String)
    (O : r.lookupLocal? x=some (.word o)) (S : r.lookupLocal? y=some (.word s)) (V : r.lookupLocal? z=some (.word v))
    (atSlot : r.state.loadSlot (slot o s)=old) (oldFit : old<R) (enough : old<R-1 → v≤old) (ow : o<2^160) (sw : s<2^160) (on : old<R-1 → o≠0) (sn : old<R-1 → s≠0) (fit : v<R)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ q, Stmt.eval (n+15) model.core.table c r (.internalCall [] spendKey [.var x,.var y,.var z])=pure (.normal q) ∧
      q.locals=r.locals ∧ q.state.storage=(afterSpend r.state o s old v).storage := by
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
  obtain ⟨q,exec,_,stored⟩ := spendBody n {c with checked:=true} bare o s old v ow sw on sn atSlot oldFit fit enough fields events
  rw [←bd] at exec
  let returned := {q with locals:=r.locals}
  refine ⟨returned,?_,rfl,stored⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter exec]
  simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,internalCallAssign,returned]
end Inv39.Allowance
