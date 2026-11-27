import Inv39MotionCall
import Inv39MotionRejected
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Motion
private theorem okBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
theorem rejectedCall (n : Nat) (c : Context) (r : Runtime) (k : Kind) (a b val : Nat) (x y z : String)
    (X : r.lookupLocal? x=some (.word a)) (Y : k=.transfer → r.lookupLocal? y=some (.word b)) (Z : r.lookupLocal? z=some (.word val))
    (av : a<2^160) (bv : b<2^160) (V : val<R) (nz : a≠0) (nz2 : k=.transfer → b≠0)
    (spends : k≠.mint) (low : r.state.loadSlot (balanceSlot a)<val)
    (fields : c.storageFields=model.core.context.storageFields) :
    ∃ next, Stmt.eval (n+13) model.core.table c r (.internalCall [] (key k) (exprs k x y z)) = pure (.reverted next ERC20.lowFunds) := by
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
  obtain ⟨done,ev⟩ := rejectedMovement n {c with checked:=true} base k a b val av bv V nz nz2 spends low fields
  rw [←bd] at ev
  refine ⟨done,?_⟩
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  rfl
end Inv39.Motion
