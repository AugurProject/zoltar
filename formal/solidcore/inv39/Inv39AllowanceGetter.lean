import Inv39AllowanceRead
import Inv39AllowanceBindings
import Inv39Sender
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
theorem getter (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (o s v : Nat)
    (O : r.lookupLocal? "owner"=some (.word o)) (S : r.lookupLocal? "spender"=some (.word s))
    (storage : c.storageFields=model.core.context.storageFields) (atSlot : r.state.loadSlot (slot o s)=v) (fit : v<R) :
    Stmt.eval (n+3) t c r getShape.value = pure (.returned r [.word v]) := by
  let outer := r.pushScope
  let inner := outer.pushScope
  have got := value c inner o s 3 O S storage
  change readTerm.evalFuel 6 c inner=pure (.word (r.state.loadSlot (slot o s)),inner) at got
  rw [atSlot] at got
  have ret := Transfer.returns (clean readTerm) c inner v t n (Inv32Guards.clean _ _ _ _ _ fit got)
  have inside := blockReturned _ t c outer inner _ _ (stop _ _ _ _ _ _ [] _ ret)
  have sk : Stmt.eval (n+2) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  apply blockReturned (next:=outer)
  exact (seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ inside)))
private theorem pureBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem getterCall (n : Nat) (c : Context) (r : Runtime) (targets : List String) (o s v : Nat) (x y : String)
    (O : r.lookupLocal? x=some (.word o)) (S : r.lookupLocal? y=some (.word s))
    (storage : c.storageFields=model.core.context.storageFields) (atSlot : r.state.loadSlot (slot o s)=v) (fit : v<R) :
    Stmt.eval (n+4) model.core.table c r (.internalCall targets getKey [.var x,.var y])=internalCallAssign r targets [.word v] := by
  obtain ⟨f,found,ps,rs,bd⟩ := getLink
  let inner := {r with locals:=[[("owner",.word o),("spender",.word s),("_ret0",.word 0)]]}
  have enter : internalCallEnter? f [.word o,.word s] r=some (inner,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [params2,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,BindingDecl.defaultBinding,Ty.defaultValue,inner]
  have args : Expr.evalRefArgList c r [.var x,.var y] = pure ([.word o,.word s],r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var x,.var y] = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ O,Inv32ProductCall.wordArg _ _ _ _ S,pureBind]
  have body := getter n model.core.table {c with checked:=true} inner o s v rfl rfl storage atSlot fit
  rw [←bd] at body
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter body]
  have ret : coerceReturnBindingsRef f.returns inner [.word v]=.ok [.word v] := by
    rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret]
  rfl
end Inv39.Allowance
