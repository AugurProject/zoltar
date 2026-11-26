import Inv39MotionExecution
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Motion
private theorem okBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
def exprs (k : Kind) (x y z : String) : List Source.Expr :=
  if k=.transfer then [.var x,.var y,.var z] else [.var x,.var z]
def values (k : Kind) (a b v : Nat) : List Source.Value :=
  if k=.transfer then [.word a,.word b,.word v] else [.word a,.word v]
theorem call (n : Nat) (c : Context) (r : Runtime) (k : Kind) (a b val : Nat) (x y z : String)
    (X : r.lookupLocal? x=some (.word a)) (Y : k=.transfer → r.lookupLocal? y=some (.word b)) (Z : r.lookupLocal? z=some (.word val))
    (av : a<2^160) (bv : b<2^160) (V : val<R) (nz : a≠0) (nz2 : k=.transfer → b≠0)
    (debit : ERC20.fromBounds r.state (fromAddress k a) val)
    (credit : ERC20.toBounds (ERC20.afterFrom r.state (fromAddress k a) val) (toAddress k a b) val)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+13) model.core.table c r (.internalCall [] (key k) (exprs k x y z)) = pure (.normal next) ∧
      next.locals = r.locals ∧ next.state.storage=(ERC20.afterTo (ERC20.afterFrom r.state (fromAddress k a) val) (toAddress k a b) val).storage := by
  obtain ⟨fn,found,ps,rs,bd⟩ := linked k
  let base := {r with locals:=[]}
  let inner := base.withFrame (frame k a b val)
  have args : Expr.evalRefArgList c r (exprs k x y z) = pure (values k a b val,r) := by
    cases k <;> simp only [exprs,values,reduceCtorEq,if_false,if_true] <;>
      simp only [Expr.evalRefArgList,Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,
        Inv32ProductCall.wordArg _ _ _ _ X,Inv32ProductCall.wordArg _ _ _ _ Z,okBind]
    simp only [Inv32ProductCall.wordArg _ _ _ _ (Y rfl),Inv32ProductCall.wordArg _ _ _ _ Z,okBind]
  have enter : internalCallEnter? fn (values k a b val) r = some (inner,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    cases k <;> simp [values,params,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,
      Runtime.withFrame,inner,frame,base]
  obtain ⟨done,ev,_,stored⟩ := movement n {c with checked:=true} base k a b val av bv V nz nz2 debit credit fields events
  rw [←bd] at ev
  let post := {done with locals:=r.locals}
  refine ⟨post,?_,rfl,stored⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,internalCallAssign,post]
end Inv39.Motion
