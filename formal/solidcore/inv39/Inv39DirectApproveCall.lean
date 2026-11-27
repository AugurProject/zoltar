import Inv39SpendCall
import Inv39DirectApproveBody
import Inv39AllowanceBindings
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
private theorem pureBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem directHelper : ∃ f, model.core.table.lookup? approve3Key=some f ∧ f.params=params3 ∧ f.returns=[] ∧ f.body=approve3Shape.value := by
  have h := approveChecked; simp only [Bool.and_eq_true] at h
  obtain ⟨f,eq,m,b⟩ := lookupCertified approve3Key approve3Shape spendMeta h.1
  refine ⟨f,eq,?_,?_,b⟩ <;> unfold spendMeta at m <;> split at m <;> simp_all [params2,params3]
theorem approve3Call (n : Nat) (c : Context) (r : Runtime) (o s v : Nat) (x y z : String)
    (O : r.lookupLocal? x=some (.word o)) (S : r.lookupLocal? y=some (.word s)) (V : r.lookupLocal? z=some (.word v))
    (ow : o<2^160) (sw : s<2^160) (fit : v<R) (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    let statement := Source.Stmt.internalCall [] approve3Key [.var x,.var y,.var z]
    ∃ q, Stmt.eval (n+11) model.core.table c r statement=pure (.reverted q (zeroApproval o)) ∨
      (Stmt.eval (n+11) model.core.table c r statement=pure (.normal q) ∧ q.locals=r.locals ∧ q.state.storage=(r.state.storeSlot (slot o s) v).storage) := by
  obtain ⟨fn,found,ps,rs,bd⟩ := directHelper
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
  obtain ⟨q,fail|⟨exec,stored⟩⟩ := approve3Body n {c with checked:=true} bare o s v ow sw fit fields events
  · rw [←bd] at fail
    refine ⟨q,.inl ?_⟩
    rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter fail]; rfl
  · rw [←bd] at exec
    let post := {q with locals:=r.locals}
    refine ⟨post,.inr ⟨?_,rfl,stored⟩⟩
    rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter exec]
    simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,internalCallAssign,post]
end Inv39.Allowance
