import Inv39ApproveBody
import Inv39AllowanceBindings
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Allowance
private theorem pureBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem approveCall (n : Nat) (c : Context) (r : Runtime) (o s v : Nat) (flag : Bool) (x y z fName : String)
    (O : r.lookupLocal? x=some (.word o)) (S : r.lookupLocal? y=some (.word s)) (V : r.lookupLocal? z=some (.word v))
    (F : r.lookupLocal? fName=some (.word (boolWord flag))) (ow : o<2^160) (sw : s<2^160) (on : o≠0) (sn : s≠0) (fit : v<R)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ q, Stmt.eval (n+6) model.core.table c r (.internalCall [] approveKey [.var x,.var y,.var z,.var fName])=pure (.normal q) ∧
      q.locals=r.locals ∧ q.state.storage=(r.state.storeSlot (slot o s) v).storage := by
  obtain ⟨fn,found,ps,rs,bd⟩ := approveLink
  let values := [Source.Value.word o,.word s,.word v,.word (boolWord flag)]
  let bare := {r with locals:=[]}
  let entry := bare.withFrame (args4 o s v flag)
  have args : Expr.evalRefArgList c r [.var x,.var y,.var z,.var fName]=pure (values,r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var x,.var y,.var z,.var fName]=_
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ O,
      Inv32ProductCall.wordArg _ _ _ _ S,Inv32ProductCall.wordArg _ _ _ _ V,Inv32ProductCall.wordArg _ _ _ _ F,pureBind,values]
  have enter : internalCallEnter? fn values r=some (entry,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; cases flag <;> simp [params4,params2,values,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,
      args4,Runtime.withFrame,entry,bare,boolWord,wordTruthy,wordEq]
  obtain ⟨q,exec,_,stored⟩ := approveBody n {c with checked:=true} bare o s v flag ow sw on sn fit fields events
  rw [←bd] at exec
  let returned := {q with locals:=r.locals}
  refine ⟨returned,?_,rfl,stored⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter exec]
  simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,internalCallAssign,returned]
end Inv39.Allowance
