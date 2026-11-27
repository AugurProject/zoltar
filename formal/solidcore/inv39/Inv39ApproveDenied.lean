import Inv39ApproveCall
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
def zeroApproval (o : Nat) := RevertData.error (if o=0 then "ERC20 approval owner must not be the zero address" else "ERC20 approval spender must not be the zero address")
theorem deniedBody (n : Nat) (c : Context) (r : Runtime) (o s v : Nat) (flag : Bool) (ow : o<R) (invalid : o=0 ∨ s=0) (fit : v<R) :
    let start := r.withFrame (args4 o s v flag)
    Stmt.eval (n+5) model.core.table c start approveShape.value=pure (.reverted start (zeroApproval o)) := by
  let t := model.core.table
  let start := r.withFrame (args4 o s v flag)
  let outer := start.pushScope
  let inner := outer.pushScope
  let first := (Motion.forbid "owner" "ERC20 approval owner must not be the zero address").value
  let second := (Motion.forbid "spender" "ERC20 approval spender must not be the zero address").value
  let store := Source.Stmt.assign place (Child.cv "value")
  have inside : Stmt.evalList (n+3) t c inner [first,second,store,notifyStmt]=pure (.reverted inner (zeroApproval o)) := by
    by_cases oz : o=0
    · have bad := Motion.zeroGuard n t c inner "owner" "ERC20 approval owner must not be the zero address"
        (show inner.lookupLocal? "owner"=some (.word 0) by rw [←oz]; rfl)
      simpa only [zeroApproval,if_pos oz] using Inv32Revert.stop _ t c inner inner first [second,store,notifyStmt] _ bad
    · have sz := invalid.resolve_left oz
      have go := Motion.guardRun (n+1) t c inner "owner" "ERC20 approval owner must not be the zero address" o rfl ow oz
      have bad := Motion.zeroGuard n t c inner "spender" "ERC20 approval spender must not be the zero address"
        (show inner.lookupLocal? "spender"=some (.word 0) by rw [←sz]; rfl)
      simpa only [zeroApproval,if_neg oz] using (seqStep _ t c inner inner first _ go).trans (Inv32Revert.stop _ t c inner inner second [store,notifyStmt] _ bad)
  have block := Inv32Revert.blockRevert _ t c outer inner _ _ inside
  have sk : Stmt.eval (n+4) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have prm := cleanParamExec (n+3) t c outer "value" v fit rfl (by dsimp [outer,start,args4]; write_param)
  apply Inv32Revert.blockRevert (next:=outer)
  exact (seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ prm).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ block))))
private theorem pureBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem deniedCall (n : Nat) (c : Context) (r : Runtime) (o s v : Nat) (flag : Bool) (x y z fName : String)
    (O : r.lookupLocal? x=some (.word o)) (S : r.lookupLocal? y=some (.word s)) (V : r.lookupLocal? z=some (.word v))
    (F : r.lookupLocal? fName=some (.word (boolWord flag))) (ow : o<R) (invalid : o=0 ∨ s=0) (fit : v<R)
    :
    ∃ q, Stmt.eval (n+6) model.core.table c r (.internalCall [] approveKey [.var x,.var y,.var z,.var fName])=pure (.reverted q (zeroApproval o)) := by
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
  have exec := deniedBody n {c with checked:=true} bare o s v flag ow invalid fit
  rw [←bd] at exec
  refine ⟨entry,?_⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter exec]; rfl
end Inv39.Allowance
